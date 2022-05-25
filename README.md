node-docker-router
==================
node-docker-router is an experimental, automated HTTP router for Docker Container powered by [Node.js](https://nodejs.org/en/about/).

How does it work?
-----------------
node-docker-router is built around a simple concept: It automatically forwards HTTP requests to the associated Container based on its Host/Domain name. This utilizes the [Docker Engine API](https://docs.docker.com/engine/api/v1.41/#operation/ContainerInspect) to get the container IP address, to then cache it to prevent repeated lookups.

In simple words, If the domain name is `example.com`, then the container name should be `example_com`.
The underscore character was chosen simply because it's one of those special characters that won't be urlencoded, it also plays well as a container name.
```
  https://example.com
           |
           |
           v

  Host: example.com:443
 ______________________
|                      |        Container Name
|  node-docker-router  |        
|                      |
|    listen:target     |        example_com:80
|       443:80         | ---->  172.18.0.3 :80
|        80:80         |
|                      |        another_com:80
|______________________|        172.18.0.4 :80
```

Features
--------
* No need to restart service if domain/container name is changed ([docker rename](https://docs.docker.com/engine/reference/commandline/rename/) command doesn't require restart!)
* Multiple listen and target ports
* Built-in Simple HTML cache mechanism
* Built with Stream in mind to download/stream large files without having to load the entire file into memory

node-docker-router also supports manual routing by modifying the [routes.js](routes.js) file.

Basic Configuration
-------------------
Just edit the [.env](.env) file.

Usage
-----
There are many ways to run this as I have explained also in [node-protocol-multiplexer](https://github.com/nggit/node-protocol-multiplexer), the entry point is [run.sh](run.sh):
```
sh run.sh
```
License
-------
MIT
