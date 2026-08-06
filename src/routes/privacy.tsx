import { createFileRoute } from '@tanstack/react-router'
import { getBaseUrl } from '@/core/api/site.api'
import { Privacy } from '@/pages/privacy'

export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: [{ title: 'Privacy · tokenmaxer.quest' }],
  }),
  loader: () => getBaseUrl(),
  component: PrivacyPage,
})

function PrivacyPage() {
  const base = Route.useLoaderData()
  return <Privacy base={base} />
}
