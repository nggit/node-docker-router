FROM alpine:latest

# update system
RUN apk update && apk upgrade

# install required packages
RUN apk add acl shadow nodejs

# clean up after installing packages
RUN rm -rf /var/cache/apk/*

# create a non-root user
RUN useradd --home-dir /app --create-home --user-group app

EXPOSE 8080 8443

WORKDIR /app

ENTRYPOINT ["/usr/bin/env"]

CMD ["sh", "-c", "setfacl -m u:app:rw /var/run/docker.sock; su - app; sh run.sh"]
