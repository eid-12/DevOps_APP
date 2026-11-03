FROM alpine:3.20
RUN apk add --no-cache iptables iptables-legacy
COPY guard.sh /usr/local/bin/guard.sh
RUN chmod 0755 /usr/local/bin/guard.sh
ENTRYPOINT ["/usr/local/bin/guard.sh"]
