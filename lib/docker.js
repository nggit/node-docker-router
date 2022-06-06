'use strict';

const net = require('net');
const { errors, log } = require('./logs');

const path = process.env.DOCKER_API_ENDPOINT || '/var/run/docker.sock';
const network = process.env.DOCKER_NETWORK_NAME;

const headers = [
  'Host: localhost',
  'User-Agent: node-docker-router',
  'Accept: */*',
  'Content-Type: application/json',
  'Connection: close'
];

function inspect(name) {
  return new Promise((resolve, reject) => {
    let timeout;

    const client = net.createConnection({ path: path }, () => {
      clearTimeout(timeout);
      client.write('GET /containers/'  + name +  '/json HTTP/1.0\r\n' + headers.join('\r\n') + '\r\n\r\n');
    });

    let ipAddress;
    let dataStr = '';

    client.on('data', data => {
      dataStr += data.toString();
    });

    timeout = setTimeout(() => {
      reject('inspect: timeout');
      client.destroy();
    }, 10000);

    client.on('error', err => {
      clearTimeout(timeout);
      reject('inspect: ' + errors.getMessage(err.code));
    });

    client.on('end', () => {
      const jsonStr = dataStr.substring(dataStr.indexOf('\r\n\r\n'));
      let networks = {};
      let msg = 'inspect: error';

      try {
        const jsonObj = JSON.parse(jsonStr);

        if (jsonObj) {
          if (jsonObj.NetworkSettings) {
            networks = jsonObj.NetworkSettings.Networks;
          } else if (jsonObj.message) {
            msg = jsonObj.message;
          }
        }
      } catch (e) {
        log('inspect: %s: %s', e.name, e.message);
      }

      for (const i in networks) {
        if (i === network) {
          break;
        }

        ipAddress = networks[i].IPAddress;
      }

      if (ipAddress) {
        resolve(ipAddress);
      } else {
        reject(msg);
      }
    });
  });
}

module.exports = {
  inspect
};
