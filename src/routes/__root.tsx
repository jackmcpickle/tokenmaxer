import {
    Outlet,
    createRootRoute,
    HeadContent,
    Scripts,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { EmbeddedLayoutContext } from '@/pages/embedded-layout';
import '@/styles/app.css';

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { charSet: 'utf-8' },
            {
                name: 'viewport',
                content: 'width=device-width, initial-scale=1',
            },
            { title: 'tokenmaxer.quest' },
            { name: 'theme-color', content: '#0a0a0a' },
        ],
        links: [
            { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
            {
                rel: 'icon',
                href: '/favicon-32x32.png',
                type: 'image/png',
                sizes: '32x32',
            },
            {
                rel: 'icon',
                href: '/favicon-16x16.png',
                type: 'image/png',
                sizes: '16x16',
            },
            {
                rel: 'apple-touch-icon',
                href: '/apple-touch-icon.png',
                sizes: '180x180',
            },
            { rel: 'manifest', href: '/site.webmanifest' },
            { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
            {
                rel: 'preconnect',
                href: 'https://fonts.gstatic.com',
                crossOrigin: 'anonymous',
            },
            {
                href: 'https://fonts.googleapis.com/css2?family=Mona+Sans:wght@500;600;700;800;900&family=Inter:opsz,wght@14..32,400;14..32,500&display=swap',
                rel: 'stylesheet',
            },
        ],
    }),
    component: RootComponent,
});

function RootComponent() {
    return (
        <RootDocument>
            <EmbeddedLayoutContext.Provider value={true}>
                <Outlet />
            </EmbeddedLayoutContext.Provider>
        </RootDocument>
    );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body className="bg-canvas text-text antialiased">
                {children}
                <Scripts />
            </body>
        </html>
    );
}
