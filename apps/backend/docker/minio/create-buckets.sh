#!/bin/sh
# Run once by the one-shot `minio-init` service (docker-compose.yml) after
# MinIO reports healthy. Creates the two buckets ARCHITECTURE.md's Storage
# section names (public/private) and sets the public bucket's anonymous
# download policy - nothing else. No application data is touched.
set -eu

mc alias set tavla "http://minio:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

mc mb --ignore-existing "tavla/${MINIO_PUBLIC_BUCKET}"
mc mb --ignore-existing "tavla/${MINIO_PRIVATE_BUCKET}"

mc anonymous set download "tavla/${MINIO_PUBLIC_BUCKET}"

echo "MinIO buckets ready: ${MINIO_PUBLIC_BUCKET} (public), ${MINIO_PRIVATE_BUCKET} (private)"
