FROM node:24.8.0-alpine

WORKDIR /app
ENV NODE_ENV=production \
    VIDEOOS_WEB_HOST=0.0.0.0 \
    VIDEOOS_WEB_PORT=3000

COPY --chown=node:node apps/web ./apps/web
COPY --chown=node:node .project/state.json ./.project/state.json
COPY --chown=node:node backlog/tasks ./backlog/tasks

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.mjs"]
