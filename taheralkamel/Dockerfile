FROM node:18-alpine


WORKDIR /app

# Copy all files first (simpler approach for Kamal)
COPY . .

# Install dependencies
RUN npm install --omit=dev

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S taher -u 1001 -G nodejs

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Change ownership to non-root user
RUN chown -R taher:nodejs /app
USER taher

# Create volume for persistent data
VOLUME ["/app/data"]

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/up', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Set production environment
ENV NODE_ENV=production

# Start the server
CMD ["npm", "start"]
