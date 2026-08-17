FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git tini xz-utils \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/riftgrid-fivem
RUN chmod 0755 /usr/local/bin/riftgrid-fivem

EXPOSE 30120/tcp 30120/udp 40120/tcp
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/riftgrid-fivem"]
