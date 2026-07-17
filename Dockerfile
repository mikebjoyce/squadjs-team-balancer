FROM node:18-slim

WORKDIR /work

COPY testing/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["all"]
