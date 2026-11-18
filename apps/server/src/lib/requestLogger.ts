import { logger } from 'hono/logger';

// Backup download URLs carry a short-lived credential. Log the path without its query.
export const requestLogger = logger((message, ...rest) => {
  console.log(message.replace(/\?\S*/, ''), ...rest);
});
