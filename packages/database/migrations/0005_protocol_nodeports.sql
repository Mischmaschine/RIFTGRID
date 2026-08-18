DROP INDEX IF EXISTS "ports_port_uq";

UPDATE "port_allocations" AS udp
SET "port" = tcp."port"
FROM "port_allocations" AS tcp
INNER JOIN "servers" AS server ON server."id" = tcp."server_id"
WHERE udp."server_id" = tcp."server_id"
  AND server."installer_id" = 'fivem'
  AND tcp."purpose" = 'game-tcp'
  AND tcp."protocol" = 'TCP'
  AND udp."purpose" = 'game-udp'
  AND udp."protocol" = 'UDP';

CREATE UNIQUE INDEX "ports_protocol_port_uq"
  ON "port_allocations" USING btree ("protocol", "port");
