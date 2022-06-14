// Copyright (c) 2022 nggit

'use strict';

const cluster = require('cluster');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const querystring = require('querystring');
const tls = require('tls');
const util = require('util');
const docker = require('./lib/docker');
const { debugs, errors, log } = require('./lib/logs');
const parse = require('./lib/parse');
const { map } = require('./config/routes');

function toNumber(str) {
  return Number.parseInt(str, 10) || 0;
}

// where this program will listen on
const listenHost = process.env.APP_HOST ? process.env.APP_HOST : '0.0.0.0'; // no need to change this

const ports = {
  http: process.env.APP_HTTP_PORT ? process.env.APP_HTTP_PORT.replace(/\s+/g, '').split(',') : ['80:80'],
  https: process.env.APP_HTTPS_PORT ? process.env.APP_HTTPS_PORT.replace(/\s+/g, '').split(',') : ['443:80']
};

const targets = {};

const workerNum = Math.min(process.env.APP_WORKER_NUM || 1, os.cpus().length);

const cacheDir = process.env.APP_CACHE_DIR;
const cacheMaxAge = process.env.APP_CACHE_MAX_AGE || toNumber(process.env.APP_CACHE_MAX_AGE) || 120;
const cacheMaxFileSize = process.env.APP_CACHE_MAX_FILE_SIZE || toNumber(process.env.APP_CACHE_MAX_FILE_SIZE) || 2097152;

const clientMaxBodySize = process.env.APP_CLIENT_MAX_BODY_SIZE || toNumber(process.env.APP_CLIENT_MAX_BODY_SIZE) || 2097152;
const dockerRouteTTL = process.env.APP_DOCKER_ROUTE_TTL || toNumber(process.env.APP_DOCKER_ROUTE_TTL) || 3600;
const proxyConnectTimeout = process.env.APP_PROXY_CONNECT_TIMEOUT || toNumber(process.env.APP_PROXY_CONNECT_TIMEOUT) || 30;

const appDebug = process.env.APP_DEBUG && process.env.APP_DEBUG.toLowerCase() === 'true';

const debug = new debugs(appDebug);

const serverOnConnect = function(socket) {
  debug.print('Client connected to worker %d', process.pid);

  // a raw http header received from the client
  // it will be filled until a \r\n\r\n is found or exceeds the allowed header length (8K)
  // otherwise it will end up with a bad request or request header too large
  let header = Buffer.alloc(0);

  // when the end of the header is reached or a \r\n\r\n is found, the client variable will be defined
  let client;
  let timeouts = {};
  let cacheEnabled = process.env.APP_CACHE_DIR || false;

  const localPort = socket.localPort;

  const reqOnData = function(data) {
    clearTimeout(timeouts.socket);

    if (client === undefined) {
      data = Buffer.concat([header, data]);

      if (data.indexOf('\r\n\r\n') > 0) {
        socket.pause();

        const reqHeader = parse.header(data.toString('latin1')).append({
          'X-Forwarded-For': socket.remoteAddress.substring(socket.remoteAddress.lastIndexOf(',')).replace(/^,\s*/, ''),
          'X-Forwarded-Proto': ports.https.indexOf(localPort) > -1 ? 'https' : 'http'
        });

        if (!(reqHeader.getHost() && reqHeader.getPath() && reqHeader.getMethod())) {
          return socket.write(
            'HTTP/1.0 400 Bad Request\r\n' +
            'Connection: close\r\n\r\n' +
            'Bad request', undefined, () => socket.destroy()
          );
        }

        const domain = reqHeader.getHost().replace(/:\d+$/, ''); // host without port
        const name = parse.domain(domain).getName(); // in docker context, "name" means the container name

        // currently we are using encodeURIComponent instead of hashing solutions
        // it's fast, no collisions, but can only cache files with a maximum name length of 255
        const cacheFile = encodeURIComponent(reqHeader.getPath());
        const cachePath = (cacheDir || '/tmp/.node-docker-router/cache').replace(/\/+$/, '')
          + '/' + name + '/' + ports[localPort] + '/' + reqHeader.getProtocolVersion() + '/gzip-'
          + ([reqHeader.getHeaders()['accept-encoding']].join().toLowerCase().indexOf('gzip') > -1) + '/' + cacheFile;

        cacheEnabled = cacheEnabled && cacheFile.length < 256 && reqHeader.getMethod().toUpperCase() === 'GET';

        const proxy = function(ipAddress, port) {
          port = port || ports[localPort];

          debug.print(Object.assign(reqHeader.getHeaders(), { _targetHost: ipAddress, _targetPort: port }));

          client = net.createConnection({ port: port, host: ipAddress, noDelay: true }, () => {
            clearTimeout(timeouts.client);
            debug.print('*** Connected to', ipAddress, 'port', port);
          });

          timeouts.client = setTimeout(() => {
            debug.print('client: timeout');
            client.destroy();
            socket.write(
              'HTTP/1.0 503 Service Unavailable\r\n' +
              'Connection: close\r\n\r\n' +
              'Failed to establish connection to the origin server', undefined, () => socket.destroy()
            );
          }, proxyConnectTimeout * 1000);

          client.on('error', err => {
            clearTimeout(timeouts.client);

            // this will refresh the cached ip address
            if (targets[name] && ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH'].indexOf(err.code) > -1) {
              delete targets[name];
            }

            const msg = {
              ECONNREFUSED: util.format('Failed to connect to %s (%s) port %d', name, ipAddress, port)
            }[err.code] || util.format('Service unavailable (%s)', err.code);

            socket.write(
              'HTTP/1.0 503 Service Unavailable\r\n' +
              'Connection: close\r\n\r\n' +
              msg, undefined, () => socket.destroy()
            );
            log('%s: %s', name, errors.getMessage(err.code));
          });

          client.on('end', () => {
            debug.print('*** Disconnected from', ipAddress, 'port', port);
          });

          client.on('close', () => {
            debug.print('Connection to', ipAddress, 'port', port, 'has been closed');
          });

          let writeCache;
          let bytesRead = 0;

          if (cacheEnabled) {
            let buf = Buffer.alloc(0);

            client.on('data', data => {
              if (!cacheEnabled) {
                return;
              }

              if (writeCache === undefined) {
                data = Buffer.concat([buf, data]);

                if (data.indexOf('\r\n\r\n') > 0) {
                  client.pause();

                  const resHeader = parse.header(data.toString('latin1')).append({ 'Cache-Control': 'public, max-age=' + cacheMaxAge });

                  debug.print(resHeader.getHeaders());

                  if (
                      [200].indexOf(resHeader.getStatusCode()) === -1
                      || resHeader.getHeaders()['content-type'] && resHeader.getHeaders()['content-type'].toLowerCase().indexOf('text/html') === -1
                      || resHeader.getHeaders()['content-length'] && toNumber(resHeader.getHeaders()['content-length']) > cacheMaxFileSize
                  ) {
                    cacheEnabled = false;
                  }

                  if (cacheEnabled) {
                    const cacheControl = resHeader.getHeaders()['cache-control'];

                    if (cacheControl) {
                      const cacheControls = querystring.parse(cacheControl.toLowerCase().replace(/\s+/g, ''), ',');

                      if (
                          cacheControls['private'] || cacheControls['no-store'] || cacheControls['no-cache']
                          || cacheControls['max-age'] && toNumber(cacheControls['max-age']) < cacheMaxAge
                          || cacheControls['s-maxage'] && toNumber(cacheControls['s-maxage']) < cacheMaxAge
                      ) {
                        cacheEnabled = false;
                      }
                    }
                  }

                  if (cacheEnabled) {
                    fs.mkdir(path.dirname(cachePath), { recursive: true }, err => {
                      writeCache = fs.createWriteStream(cachePath, { encoding: null, flags: 'wx' });

                      writeCache.on('error', err => {
                        cacheEnabled = false;

                        client.resume();
                        log('writeCache: %s: %s', cachePath, errors.getMessage(err.code));
                      });

                      writeCache.write(resHeader.getResult(), 'latin1', () => client.resume());
                    });
                  } else {
                    client.resume();
                  }

                  bytesRead += resHeader.getResult().length;
                } else {
                  buf = data;

                  if (buf.length > 16 * 1024) {
                    cacheEnabled = false;
                  }
                }
              } else {
                if (bytesRead > cacheMaxFileSize) {
                  cacheEnabled = false;

                  writeCache.close(() => fs.unlink(cachePath, err => {}));
                } else {
                  writeCache.write(data);

                  bytesRead += data.length;
                }
              }
            });
          } // cacheEnabled

          // receive data from target then send it to client
          client.pipe(socket).on('finish', () => {
            client.end();

            if (writeCache) {
              writeCache.close(() => {
                fs.stat(cachePath, (err, stats) => {
                  if (stats && stats.size !== bytesRead) {
                    log('Failed to write cache file');
                    fs.unlink(cachePath, err => {});
                  }
                });
              });
            }
          });

          // a \r\n\r\n is found, sending to the destination server for the first time
          client.write(reqHeader.getResult(), 'latin1', () => socket.resume());
        } // proxy

        let readCache;

        const useCache = new Promise((resolve, reject) => {
          if (cacheEnabled) {
            readCache = fs.createReadStream(cachePath, { encoding: null, highWaterMark: 16 * 1024 });

            readCache.on('open', () => {
              client = true;

              socket.resume();
              resolve();
            });

            readCache.on('error', err => reject(err));
          } else {
            reject();
          }
        });

        useCache.then(() => readCache.pipe(socket).on('finish', () => {
          readCache.close();
          debug.print('*** Served from cache', cachePath);

          fs.stat(cachePath, (err, stats) => {
            if (stats && ((Date.now() - stats.birthtimeMs > cacheMaxAge * 1000 ) || stats.size === 0)) {
              fs.unlink(cachePath, err => {});
            }
          });
        })).catch(() => {
          if (targets[name]) {
            proxy(targets[name].ipAddress, targets[name].port);

            if (Date.now() - targets[name].time > dockerRouteTTL * 1000) {
              delete targets[name];
            }
          } else {
            let [ipAddress, port] = map(name).split(':');
            port = toNumber(port);

            if (ipAddress) {
              proxy(ipAddress, port);
            } else {
              docker.inspect(name).then(ipAddress => {
                proxy(ipAddress);

                // cache ip address
                targets[name] = { ipAddress: ipAddress, time: Date.now() };
              }).catch(msg => {
                socket.write(
                  'HTTP/1.0 503 Service Unavailable\r\n' +
                  'Connection: close\r\n\r\n' +
                  'Failed to lookup ' + name + ': ' + msg, undefined, () => socket.destroy()
                );
                log('%s: %s', reqHeader.getHost(), msg);
              });
            }
          }
        });
      } else {
        // a \r\n\r\n has not yet been found
        // fill data into the header, until a \r\n\r\n is found
        header = data;

        if (header.length > 8192) {
          let msg;

          if (header.indexOf(' HTTP/') > 0 && header.toString().toLowerCase().indexOf('\r\nhost:') > 0) {
            // if it's a valid request, then it's not a "bad request"
            msg = 'Request header too large';
          } else {
            msg = 'Bad request';
          }

          socket.write(
            'HTTP/1.0 400 Bad Request\r\n' +
            'Connection: close\r\n\r\n' +
            msg, undefined, () => socket.destroy()
          );
        } else {
          timeouts.socket = setTimeout(() => {
            debug.print('socket: timeout');
            socket.end(
              'HTTP/1.0 408 Request Timeout\r\n' +
              'Connection: close\r\n\r\n' +
              'Timed out while waiting for request to complete'
            );
          }, 30000);
        }
      }
    } else if (typeof client === 'object') {
      if (socket.bytesRead - 8192 > clientMaxBodySize) {
        debug.print('socket: request entity too large');
        client.end();
        socket.destroy();
      } else {
        // the client variable has been defined or a \r\n\r\n is found, send the rest
        client.write(data);
      }
    }
  } // reqOnData

  socket.on('data', reqOnData);

  socket.on('error', err => {
    if (typeof client === 'object') {
      client.end();
    }

    log('socket:', errors.getMessage(err.code));
  });

  socket.on('end', () => {
    debug.print('Client disconnected from worker %d', process.pid);
  });

  socket.on('close', () => {
    debug.print('Connection closed on worker %d', process.pid);
  });
}

function mergeOptions(defaultOpts, options) {
  return Object.assign(
    Object.assign({}, defaultOpts),
    Object.assign({}, options)
  );
}

const options = { noDelay: true };

const servers = {
  http: () => net.createServer(options, serverOnConnect),
  https: () => tls.createServer(
    mergeOptions(options, {
      cert: fs.existsSync(process.env.APP_SSL_CERTIFICATE) ? fs.readFileSync(process.env.APP_SSL_CERTIFICATE) : '',
      key: fs.existsSync(process.env.APP_SSL_CERTIFICATE_KEY) ? fs.readFileSync(process.env.APP_SSL_CERTIFICATE_KEY) : ''
    }),
    serverOnConnect
  )
};

if (workerNum > 1 && !cluster.isWorker) {
  log('Node Docker Router (pid %d) is running. Starting %d workers...', process.pid, workerNum);

  for (let i = 0; i < workerNum; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    log('Worker %d died (%s)', worker.process.pid, signal || code);

    if (code !== 0) {
      console.log('Starting a new worker...');
      cluster.fork();
    }
  });
} else {
  for (const i in servers) {
    for (const port of ports[i]) {
      const [listenPort, targetPort] = port.split(':').map(n => toNumber(n));
      ports[listenPort] = targetPort || listenPort;

      const server = servers[i]();

      server.on('error', err => {
        log(errors.getMessage(err.code));

        setTimeout(() => {
          server.close();
          server.listen(listenPort, listenHost);
        }, 1000);
      });

      server.listen(listenPort, listenHost, () => {
        console.log('Node Docker Router (pid %d) is started at %s port %d:%d', process.pid, listenHost, listenPort, ports[listenPort]);
      });
    }
  }
}
