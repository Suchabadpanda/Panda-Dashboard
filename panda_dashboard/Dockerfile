# Pinned to the official nginx image on purpose. The Supervisor passes its own
# BUILD_FROM (the HA base image, which has no web server), so don't use it here.
# alpine-slim: nginx and its entrypoint hooks only, without the extra modules (njs, xslt,
# geoip, image-filter) and curl that the plain alpine tag adds; none are used here.
FROM nginx:1.27-alpine-slim

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY www/ /usr/share/nginx/html/
# Runs as root before nginx starts (nginx image entrypoint hook)
COPY rootfs-options.sh /docker-entrypoint.d/05-options.sh
RUN chmod +x /docker-entrypoint.d/05-options.sh

LABEL io.hass.type="addon" io.hass.name="Panda Dashboard"
