import { createFileRoute } from '@tanstack/react-router';
import { getBaseUrl } from '@/core/api/site.api';
import { Login } from '@/pages/login';

export const Route = createFileRoute('/login')({
    head: () => ({
        meta: [{ title: 'Log in · tokenmaxer.quest' }],
    }),
    validateSearch: (search: Record<string, unknown>) => ({
        next:
            typeof search.next === 'string' && search.next.startsWith('/')
                ? search.next
                : undefined,
    }),
    loaderDeps: ({ search }) => search,
    loader: async ({ deps }) => ({
        base: await getBaseUrl(),
        next: deps.next,
    }),
    component: LoginPage,
});

function LoginPage() {
    const { base, next } = Route.useLoaderData();
    return (
        <Login
            base={base}
            next={next}
        />
    );
}
