import handler from '@tanstack/react-start/server-entry'
// For now re-export TanStack handler; we'll wrap Hono next
export default {
  fetch: handler.fetch.bind(handler),
}
