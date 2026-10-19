# Pinned to the official nginx image on purpose. The Supervisor passes its own
# BUILD_FROM (the HA base image, which has no web server), so don't use it here.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY www/ /usr/share/nginx/html/

LABEL io.hass.type="addon" io.hass.name="Panda Dashboard"
