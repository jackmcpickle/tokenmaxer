import { createFileRoute } from '@tanstack/react-router'
import { getHackathonBoardPageData } from '@/core/api/board.api'
import { HackathonPage } from '@/pages/hackathon'
import { Layout } from '@/pages/layout'
import { sub } from '@/pages/ui'
import { isMetric, type Metric } from '@/types'

export const Route = createFileRoute('/h/$slug')({
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.hackathon
          ? `${loaderData.hackathon.name} · tokenmaxer.quest`
          : 'Hackathon not found · tokenmaxer.quest',
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    metric: (() => {
      const raw = search.metric
      return isMetric(raw) ? raw : ('cost' as Metric)
    })(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const data = await getHackathonBoardPageData({
      data: { slug: params.slug, metric: deps.metric },
    })
    if (!data.hackathon) setResponseStatus(404)
    return data
  },
  component: HackathonBoardRoute,
})

function HackathonBoardRoute() {
  const data = Route.useLoaderData()
  if (!data.hackathon) {
    return (
      <Layout title="Hackathon not found · tokenmaxer.quest" base={data.base}>
        <h1>Hackathon not found</h1>
        <p className={sub}>
          That link may be wrong or the hackathon was deleted.
        </p>
      </Layout>
    )
  }
  return (
    <HackathonPage
      base={data.base}
      hackathon={data.hackathon}
      state={data.state}
      metric={data.metric}
      entries={data.entries}
      members={data.members}
      role={data.role}
      models={data.models}
    />
  )
}
