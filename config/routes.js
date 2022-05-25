'use strict';

// manually map a name to an ip address
// by using map, the ip address will not be lookedup automatically with the docker's API "inspect"
// unlike automatic lookup, using this feature requires node-docker-router to be restarted
function map(name) {
  return {
    example_com: '192.168.1.2',
    localhost_app: '192.168.1.3',

    // ...

  }[name] || '';
}

module.exports = {
  map
};
