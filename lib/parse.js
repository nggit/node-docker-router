'use strict';

// parse a raw http header
// it can parse either http request or response
// it can also append some custom names and values
function header(data) {
  let isRequest = false;
  let isResponse = false;
  let header = [];
  let body = '';
  let _headers = {};

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
          isResponse && ['cache-control', 'date', 'via'].indexOf(nameLC) > -1
          || isRequest && ['accept-encoding', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].indexOf(nameLC) > -1
      ) {
        // skipped in header but add it to _headers
        _headers[nameLC] = value;
      } else if (['proxy', 'upgrade-insecure-requests'].indexOf(nameLC) === -1) {
        if (Array.isArray(_headers[nameLC])) {
          _headers[nameLC].push(value);
        } else {
          _headers[nameLC] = _headers[nameLC] ? [_headers[nameLC], value] : value;
        }

        header.push(name + ': ' + value);
      }
    } else {
      if (line.indexOf('HTTP/') === 0) {
        isResponse = true;
        const [_protocol, _protocolVersion, _statusCode, ..._statusMessage] = line.replace(/\//, ' ').split(' ').filter(v => v);

        _headers['_protocol'] = _protocol;
        _headers['_protocolVersion'] = _protocolVersion;
        _headers['_statusCode'] = Number.parseInt(_statusCode, 10) || 0;
        _headers['_statusMessage'] = _statusMessage.join(' ');
      } else {
        const pathEndPos = line.indexOf(' HTTP/');

        if (pathEndPos > 0) {
          isRequest = true;
          const [_method, ..._path] = line.substring(0, pathEndPos).split(' ');

          _headers['_method'] = _method;
          _headers['_path'] = _path.join(' ').replace(/^\s+/, '');
          _headers['_protocolVersion'] = line.substring(pathEndPos + 6);
        }
      }

      header.push(line);
    }

    data = data.substring(lineEndPos + 2);
  }

  if (isResponse) {
    header.push('Date: ' + (new Date()).toUTCString());
    header.push('Via: ' + (_headers['_protocolVersion'] || '1.0') + ' node-docker-router');
  } else if (isRequest) {
    if (!_headers['x-forwarded-host']) {
      _headers['x-forwarded-host'] = _headers['host'];
    }

    if ([_headers['accept-encoding']].join().toLowerCase().indexOf('gzip') > -1) {
      header.push('Accept-Encoding: gzip');
    }

    if (_headers['x-forwarded-host']) {
      header.push('X-Forwarded-Host: ' + _headers['x-forwarded-host']);
    }
  }

  function append(append) {
    if (typeof append !== 'object') {
      append = {};
    }

    if (isResponse) {
      for (const i in append) {
        if (['date', 'via'].indexOf(i.toLowerCase()) === -1) {
          header.push(i + ': ' + append[i]);
        }
      }
    } else if (isRequest) {
      if (append['X-Forwarded-For']) {
        if (_headers['x-forwarded-for']) {
          append['X-Forwarded-For'] = [_headers['x-forwarded-for'], append['X-Forwarded-For']]
            .filter(v => typeof v === 'string' && v.length > 0).join(', ');
        }

        _headers['x-forwarded-for'] = append['X-Forwarded-For'];
        header.push('X-Forwarded-For: ' + _headers['x-forwarded-for']);
      }

      if (append['X-Forwarded-Proto']) {
        if (!_headers['x-forwarded-proto']) {
          _headers['x-forwarded-proto'] = append['X-Forwarded-Proto'];
        }

        header.push('X-Forwarded-Proto: ' + (_headers['x-forwarded-proto'] || 'http'));
      }

      for (const i in append) {
        if (['host', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].indexOf(i.toLowerCase()) === -1) {
          header.push(i + ': ' + append[i]);
        }
      }
    }

    return this;
  }

  return {
    append,
    getHeaders: () => _headers,
    getHost: () => _headers['x-forwarded-host'],
    getMethod: () => _headers['_method'],
    getPath: () => _headers['_path'],
    getProtocolVersion: () => _headers['_protocolVersion'],
    getResult: () => header.join('\r\n') + body,
    getStatusCode: () => _headers['_statusCode']
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
    getName: () => name
  };
}

module.exports = {
  header,
  host
};
