import { createFileRoute } from '@tanstack/react-router'
import { getProfilePageData } from '@/core/api/board.api'
import { Layout } from '@/pages/layout'
import { ProfilePage } from '@/pages/profile'
import { sub } from '@/pages/ui'

export const Route = createFileRoute('/u/$username')({
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.profile
          ? `@${loaderData.profile.username} · tokenmaxer.quest`
          : 'Not found · tokenmaxer.quest',
      },
    ],
  }),
  loader: async ({ params }) => {
    const data = await getProfilePageData({ data: { username: params.username } })
    if (!data.profile) setResponseStatus(404)
    return data
  },
  component: ProfileRoute,
})

function ProfileRoute() {
  const { base, profile } = Route.useLoaderData()
  if (!profile) {
    return (
      <Layout title="Not found · tokenmaxer.quest" base={base}>
        <h1>Builder not found</h1>
        <p className={sub}>
          No one has claimed that username yet.{' '}
          <a href="/start">Claim it →</a>
        </p>
      </Layout>
    )
  }
  return <ProfilePage base={base} profile={profile} />
}
