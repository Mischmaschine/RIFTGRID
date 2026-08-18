WITH ranked_allocations AS (
  SELECT
    allocation."id",
    row_number() OVER (
      PARTITION BY allocation."port"
      ORDER BY
        CASE WHEN server."actual_state" = 'RUNNING' THEN 0 ELSE 1 END,
        allocation."created_at",
        allocation."id"
    ) AS rank
  FROM "port_allocations" allocation
  INNER JOIN "servers" server ON server."id" = allocation."server_id"
)
DELETE FROM "port_allocations"
WHERE "id" IN (SELECT "id" FROM ranked_allocations WHERE rank > 1);

DROP INDEX IF EXISTS "ports_protocol_port_uq";
CREATE UNIQUE INDEX "ports_port_uq" ON "port_allocations" USING btree ("port");
