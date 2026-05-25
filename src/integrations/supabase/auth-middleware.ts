import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getSession } from '@server/session'

export const requireSupabaseAuth = createMiddleware({ type: 'function' })
  .server(async ({ next }) => {
    const request = getRequest()
    const session = await getSession(request as unknown as Request)
    if (!session?.userId) {
      throw new Error('Unauthorized: Please sign in to continue.')
    }
    return next({
      context: {
        supabase: null,
        userId: session.userId,
        claims: { sub: session.userId, email: session.email },
      },
    })
  })
