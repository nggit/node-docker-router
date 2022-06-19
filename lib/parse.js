'use strict';

// parse a raw http header
// it can parse either http request or response
// it can also append some custom names and values
function header(data) {
  let isRequest = false;
  let isResponse = false;
  let header = {};
  let body = '';
  let headers = {};

  const headerEndPos = data.indexOf('\r\n\r\n');

  if (headerEndPos > -1) {
    body = data.substring(headerEndPos);
    data = data.substring(0, headerEndPos);
  }

  if (data) {
    data += '\r\n';
  }

  let lineEndPos;

  while ((lineEndPos = data.indexOf('\r\n')) > -1) {
    const line = data.substring(0, lineEndPos);
    const colonPos = line.indexOf(':');

    if (colonPos > 0) {
      const name = line.substring(0, colonPos);
      const nameLC = name.toLowerCase();
      const value = line.substring(colonPos).replace(/^:\s?/, '');

      if (
          isResponse && ['date', 'via'].indexOf(nameLC) > -1
          || isRequest && ['accept-encoding', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].indexOf(nameLC) > -1
      ) {
        // skipped in header but add it to headers
        headers[nameLC] = value;
      } else if (['proxy', 'upgrade-insecure-requests'].indexOf(nameLC) === -1) {
        if (Array.isArray(headers[nameLC])) {
          headers[nameLC].push(value);
        } else {
          headers[nameLC] = headers[nameLC] ? [headers[nameLC], value] : value;
        }

        if (Array.isArray(header[name])) {
          header[nameLC].push(name + ': ' + value);
        } else {
          header[nameLC] = [name + ': ' + value];
        }
      }
    } else {
      if (line.indexOf('HTTP/') === 0) {
        isResponse = true;
        const [_protocol, _protocolVersion, _statusCode, ..._statusMessage] = line.replace(/\//, ' ').split(' ').filter(v => v);

        headers['_protocol'] = _protocol;
        headers['_protocolVersion'] = _protocolVersion;
        headers['_statusCode'] = Number.parseInt(_statusCode, 10) || 0;
        headers['_statusMessage'] = _statusMessage.join(' ');
      } else {
        const pathEndPos = line.indexOf(' HTTP/');

        if (pathEndPos > 0) {
          isRequest = true;
          const [_method, ..._path] = line.substring(0, pathEndPos).split(' ');

          headers['_method'] = _method;
          headers['_path'] = _path.join(' ').replace(/^\s+/, '');
          headers['_protocolVersion'] = line.substring(pathEndPos + 6);
        }
      }

      header[0] = [line];
    }

    data = data.substring(lineEndPos + 2);
  }

  if (isResponse) {
    header['date'] = ['Date: ' + (new Date()).toUTCString()];
    header['via'] = ['Via: ' + (headers['_protocolVersion'] || '1.0') + ' node-docker-router'];
  } else if (isRequest) {
    if (!headers['x-forwarded-host']) {
      headers['x-forwarded-host'] = headers['host'];
    }

    if ([headers['accept-encoding']].join().toLowerCase().indexOf('gzip') > -1) {
      header['accept-encoding'] = ['Accept-Encoding: gzip'];
    }

    if (headers['x-forwarded-host']) {
      header['x-forwarded-host'] = ['X-Forwarded-Host: ' + headers['x-forwarded-host']];
    }
  }

  function append(append) {
    if (typeof append !== 'object') {
      return this;
    }

    if (isResponse) {
      for (const i in append) {
        if (['date', 'via'].indexOf(i.toLowerCase()) === -1) {
          header[i.toLowerCase()] = [i + ': ' + append[i]];
        }
      }
    } else if (isRequest) {
      if (append['X-Forwarded-For']) {
        if (headers['x-forwarded-for']) {
          append['X-Forwarded-For'] = [headers['x-forwarded-for'], append['X-Forwarded-For']]
            .filter(v => typeof v === 'string' && v.length > 0).join(', ');
        }

        headers['x-forwarded-for'] = append['X-Forwarded-For'];
        header['x-forwarded-for'] = ['X-Forwarded-For: ' + headers['x-forwarded-for']];
      }

      if (append['X-Forwarded-Proto']) {
        if (!headers['x-forwarded-proto']) {
          headers['x-forwarded-proto'] = append['X-Forwarded-Proto'];
        }

        header['x-forwarded-proto'] = ['X-Forwarded-Proto: ' + (headers['x-forwarded-proto'] || 'http')];
      }

      for (const i in append) {
        if (['host', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].indexOf(i.toLowerCase()) === -1) {
          header[i.toLowerCase()] = [i + ': ' + append[i]];
        }
      }
    }

    return this;
  }

  function remove(remove) {
    if (!Array.isArray(remove)) {
      return this;
    }

    for (const v of remove) {
      delete header[v];
    }

    return this;
  }

  return {
    append,
    remove,
    save: () => Object.keys(header).map(k => header[k].join('\r\n')).join('\r\n') + body,
    getHeaders: () => headers,
    getHost: () => headers['x-forwarded-host'],
    getMethod: () => headers['_method'],
    getPath: () => headers['_path'],
    getProtocolVersion: () => headers['_protocolVersion'],
    getStatusCode: () => headers['_statusCode']
  };
}

// parse a host name to a "name", e.g. example.com to example_com
// a name will be used to lookup the ip address automatically with the docker's API "inspect"
// in docker context, "name" means the container name
function host(host) {
  let domain = host.replace(/:\d+$/, ''); // host without port
  let name;

  name = domain.replace(/^www\./i, '');
  name = name.replace(/\.+/g, '_');

  // ...

  name = encodeURIComponent(name);

  return {
    getDomain: () => domain,
    getName: () => name
  };
}

module.exports = {
  header,
  host
};
