# Stage 1: Build React frontend
# Use Node 16 - react-scripts 5.0.1 is designed for Node 16
FROM node:16-alpine AS frontend-builder

WORKDIR /frontend

ENV CI=false
ENV DISABLE_ESLINT_PLUGIN=true
ENV GENERATE_SOURCEMAP=false

# Copy package.json
COPY frontend/package.json ./

# Install with legacy peer deps and force to fix ajv-keywords issue
RUN npm install --legacy-peer-deps --no-audit --no-fund && \
    npm install ajv@^8.0.0 --legacy-peer-deps --no-audit

# Copy source
COPY frontend/ ./

# Build
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:1.25-alpine

COPY --from=frontend-builder /frontend/build /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
