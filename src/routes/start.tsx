import { createFileRoute } from '@tanstack/react-router'
import { getStartPageData } from '@/core/api/site.api'
import { Start } from '@/pages/start'

export const Route = createFileRoute('/start')({
  head: () => ({
    meta: [{ title: 'Get started · tokenmaxer.quest' }],
  }),
  loader: () => getStartPageData(),
  component: StartPage,
})

function StartPage() {
  const { base, invited } = Route.useLoaderData()
  return <Start base={base} invited={invited} />
}
