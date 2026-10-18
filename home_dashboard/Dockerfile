ARG BUILD_FROM=nginx:1.27-alpine
FROM ${BUILD_FROM}

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY www/ /usr/share/nginx/html/

LABEL io.hass.type="addon" io.hass.name="Home Dashboard"
