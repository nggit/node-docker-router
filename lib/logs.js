'use strict';

const util = require('util');
const errors = require('./errors');

function log() {
  return console.log(
    '[%s] %s',
    (new Date()).toLocaleString([], { dateStyle: 'short', timeStyle: 'long', hourCycle: 'h24', timeZone: process.env.TZ }),
    util.format(...arguments)
  );
}

function debugs(y) {
  return {
    log: function() { return y && log(...arguments) }, 
    print: function() { return y && console.log(...arguments) }
  };
}

module.exports = {
  debugs,
  errors,
  log
};
