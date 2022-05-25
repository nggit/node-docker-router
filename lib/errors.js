'use strict';

const util = require('util');

function getMessage(code) {
  return {
    EACCES: util.format('Permission denied (%s)', code),
    EADDRINUSE: util.format('Address already in use (%s)', code),
    EAI_AGAIN: util.format('Temporary failure in name resolution (%s)', code),
    ECONNREFUSED: util.format('Connection refused by remote host (%s)', code),
    ECONNRESET: util.format('Connection reset by peer (%s)', code),
    EEXIST: util.format('File already exists (%s)', code),
    ENOENT: util.format('No such file or directory (%s)', code),
    EPIPE: util.format('Broken pipe (%s)', code)
  }[code] || util.format('An error occurred (%s)', code);
}

module.exports = {
  getMessage
};
