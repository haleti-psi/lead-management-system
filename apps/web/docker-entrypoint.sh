#!/bin/sh
set -e

# Inject the lms-api Cloud Run URL into the nginx config at container start.
# Limiting envsubst to ${API_BACKEND_URL} keeps nginx's own $uri/$scheme/etc. intact.
: "${API_BACKEND_URL:?API_BACKEND_URL must be set (the lms-api Cloud Run URL)}"

envsubst '${API_BACKEND_URL}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
