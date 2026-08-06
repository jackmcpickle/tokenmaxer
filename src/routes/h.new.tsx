import { createFileRoute, redirect } from '@tanstack/react-router'
import { getHackathonNewPageData } from '@/core/api/board.api'
import { HackathonNew } from '@/pages/hackathon-new'

export const Route = createFileRoute('/h/new')({
  head: () => ({
    meta: [{ title: 'New hackathon · tokenmaxer.quest' }],
  }),
  loader: async () => {
    const data = await getHackathonNewPageData()
    if (!data.user) {
      throw redirect({ to: '/login', search: { next: '/h/new' } })
    }
    return {
      base: data.base,
      username: data.user.username,
      models: data.models,
    }
  },
  component: HackathonNewPage,
})

function HackathonNewPage() {
  const { base, username, models } = Route.useLoaderData()
  return <HackathonNew base={base} username={username} models={models} />
}
