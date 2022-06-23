node-docker-router
==================
node-docker-router is an experimental, automated HTTP router for Docker Container powered by [Node.js](https://nodejs.org/en/about/).
You may think this is an alternative to [Traefik](https://github.com/traefik/traefik) (HTTP reverse proxy).

In contrast to Traefik which heavily utilizes the [Docker Labels](https://docs.docker.com/config/labels-custom-metadata/) for advanced routing, node-docker-router instead only uses the container name.
Making it possible to reroute a container without having to restart it, just as simple as renaming the container name.

How does it work?
-----------------
node-docker-router is built around a simple concept: It automatically forwards HTTP requests to the associated Container based on its Host/Domain name.
This utilizes the [Docker Engine API](https://docs.docker.com/engine/api/v1.41/#operation/ContainerInspect) to get the container IP address, to then cache it to prevent repeated lookups.

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

node-docker-router also supports manual routing by modifying the [routes.js](config/routes.js) file.
It's like using the node-docker-router as a regular HTTP reverse proxy.

Basic Configuration
-------------------
Copy the default [config/.env](config/.env) file to this directory if you don't have one:
```
cp config/.env .
```

Then simply edit it before running `sh run.sh` or executing it via the `docker-compose` command.

Usage
-----
There are many ways to run this. The entry point is [run.sh](run.sh):
```
sh run.sh
```

Or if you prefer to run this in a container too (as a containerized app):
```
cd build/
docker-compose build
docker-compose up -d
```

Then verify if it works:
```
curl -H "Host: mydomain" http://localhost
```

License
-------
MIT
