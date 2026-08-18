FROM steamcmd/steamcmd:ubuntu-24

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libatomic1 libpulse0 \
    && rm -rf /var/lib/apt/lists/*

COPY --chmod=755 entrypoint.sh /usr/local/bin/riftgrid-valheim

ENTRYPOINT ["/usr/local/bin/riftgrid-valheim"]
