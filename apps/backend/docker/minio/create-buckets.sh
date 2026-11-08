#!/bin/sh
# Run once by the one-shot `minio-init` service (docker-compose.yml) after
# MinIO reports healthy. Creates the two buckets ARCHITECTURE.md's Storage
# section names (public/private) and gives the public bucket an anonymous
# read-only-per-object policy (s3:GetObject only). `mc anonymous set download`
# is deliberately not used: it also grants s3:ListBucket, which lets anyone
# enumerate every stored object. No application data is touched.
set -eu

mc alias set tavla "http://minio:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

mc mb --ignore-existing "tavla/${MINIO_PUBLIC_BUCKET}"
mc mb --ignore-existing "tavla/${MINIO_PRIVATE_BUCKET}"

POLICY_FILE="$(mktemp)"
cat > "$POLICY_FILE" <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::${MINIO_PUBLIC_BUCKET}/*"]
    }
  ]
}
POLICY
mc anonymous set-json "$POLICY_FILE" "tavla/${MINIO_PUBLIC_BUCKET}"
rm -f "$POLICY_FILE"

echo "MinIO buckets ready: ${MINIO_PUBLIC_BUCKET} (public), ${MINIO_PRIVATE_BUCKET} (private)"
