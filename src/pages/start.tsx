import { useEffect, useRef, useState, type FC, type FormEvent } from 'react';
import { claimSnippets } from '@/lib/claim-snippets';
import { COUNTRIES, flagEmoji } from '@/lib/countries';
import { Button } from '@/pages/components/button';
import { CopyButton } from '@/pages/components/copy-button';
import { Input } from '@/pages/components/input';
import { Layout } from '@/pages/layout';
import { StartSetup } from '@/pages/start-setup';
import { copyrow, field, fieldLbl, hero, notice, panel, sub } from '@/pages/ui';

const TURNSTILE_SITE_KEY = '0x4AAAAAAD4Z_7GmvQFkW-X3';

type TurnstileApi = {
    render: (
        el: HTMLElement,
        opts: {
            sitekey: string;
            theme?: string;
            callback?: (token: string) => void;
            'expired-callback'?: () => void;
            'error-callback'?: () => void;
        },
    ) => string;
    reset: (id?: string) => void;
    remove: (id: string) => void;
};

function turnstileApi(): TurnstileApi | undefined {
    const g = globalThis as typeof globalThis & { turnstile?: TurnstileApi };
    return g.turnstile;
}

const SETUP_TIP = (
    <>
        <p className="mb-3 text-[13px] font-medium tracking-[-0.13px] text-white/80">
            Setup tip
        </p>
        <p className="text-[22px] leading-snug tracking-[-0.01px]">
            After you claim, paste the agent prompt into your coding agent — it
            can set everything up for you.
        </p>
    </>
);

type Claimed = { username: string; token: string };

export const Start: FC<{
    base: string;
    invited: boolean;
}> = ({ base, invited }) => {
    const [error, setError] = useState('');
    const [claiming, setClaiming] = useState(false);
    const [claimed, setClaimed] = useState<Claimed | null>(null);
    const [turnstileToken, setTurnstileToken] = useState('');
    const turnstileHost = useRef<HTMLDivElement>(null);
    const turnstileWidgetId = useRef<string | null>(null);
    const resultRef = useRef<HTMLDivElement>(null);

    const showForm = invited && claimed === null;

    useEffect(() => {
        if (showForm === false) return;

        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | undefined;

        function tryRender(): boolean {
            const host = turnstileHost.current;
            const api = turnstileApi();
            if (api === undefined || host === null || cancelled) return false;
            if (turnstileWidgetId.current !== null) return true;
            turnstileWidgetId.current = api.render(host, {
                sitekey: TURNSTILE_SITE_KEY,
                theme: 'dark',
                callback: (token) => {
                    setTurnstileToken(token);
                },
                'expired-callback': () => {
                    setTurnstileToken('');
                },
                'error-callback': () => {
                    setTurnstileToken('');
                },
            });
            return true;
        }

        if (tryRender() === false) {
            let attempts = 0;
            timer = setInterval(() => {
                attempts += 1;
                if (tryRender() || attempts > 200) {
                    if (timer !== undefined) clearInterval(timer);
                }
            }, 50);
        }

        return () => {
            cancelled = true;
            if (timer !== undefined) clearInterval(timer);
            const id = turnstileWidgetId.current;
            if (id !== null) {
                turnstileApi()?.remove(id);
                turnstileWidgetId.current = null;
            }
        };
    }, [showForm]);

    useEffect(() => {
        if (claimed === null) return;
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [claimed]);

    const displayUser = claimed?.username ?? 'YOUR_USERNAME';
    const displayToken = claimed?.token ?? 'YOUR_TOKEN';
    const snippets = claimSnippets(base, displayUser, displayToken);

    function resetTurnstile(): void {
        setTurnstileToken('');
        const id = turnstileWidgetId.current;
        if (id !== null) turnstileApi()?.reset(id);
    }

    async function handleClaim(e: FormEvent<HTMLFormElement>): Promise<void> {
        e.preventDefault();
        setError('');
        const fd = new FormData(e.currentTarget);
        const username = String(fd.get('username') ?? '').trim();
        const profileUrl = String(fd.get('profile-url') ?? '').trim();
        const country = String(fd.get('country') ?? '');
        if (country.length === 0) {
            setError('Please pick your country.');
            return;
        }
        const token =
            turnstileToken || String(fd.get('cf-turnstile-response') ?? '');
        if (token.length === 0) {
            setError('Please complete the verification.');
            return;
        }
        setClaiming(true);
        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(
                    profileUrl.length > 0
                        ? {
                              username,
                              turnstileToken: token,
                              country,
                              url: profileUrl,
                          }
                        : { username, turnstileToken: token, country },
                ),
            });
            const data = (await res.json()) as {
                username?: string;
                token?: string;
                error?: string;
            };
            if (res.ok === false) {
                setError(data.error || 'Registration failed');
                resetTurnstile();
                return;
            }
            if (
                typeof data.username !== 'string' ||
                typeof data.token !== 'string'
            ) {
                setError('Registration failed');
                resetTurnstile();
                return;
            }
            setClaimed({ username: data.username, token: data.token });
        } catch {
            setError('Network error, please retry.');
            resetTurnstile();
        } finally {
            setClaiming(false);
        }
    }

    return (
        <Layout
            title="Get started · tokenmaxer.quest"
            base={base}
        >
            {invited === false && (
                <div className="mt-6 rounded-lg bg-panel2 px-4 py-3.5 text-sm text-text">
                    Username claims are invite-only.{' '}
                    <a href="mailto:jackmcpickle@gmail.com?subject=tokenmaxer.quest%20invite">
                        Email me
                    </a>{' '}
                    for an invite link.
                </div>
            )}

            <section className={hero}>
                <h1 className="reveal">Claim your name</h1>
                <p className={`${sub} reveal reveal-delay`}>
                    Pick a username, optionally add a public profile link, get a
                    token, let your agent set everything up. No email, no
                    password — the token is your only credential, so keep it
                    somewhere safe.
                </p>
            </section>

            {showForm && (
                <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div
                        id="claim-panel"
                        className={panel}
                    >
                        <div className="mb-5 grid gap-4 rounded-lg bg-panel2 p-4 sm:grid-cols-2">
                            <div>
                                <p className="mb-2 text-[13px] font-semibold tracking-[-0.13px] text-text">
                                    What we store
                                </p>
                                <ul className="list-disc space-y-1 pl-4 text-[13px] text-muted">
                                    <li>Your username &amp; country</li>
                                    <li>
                                        Per-session token counts, model &amp;
                                        tool
                                    </li>
                                    <li>Optional public profile URL</li>
                                    <li>
                                        A SHA-256 hash of your token — never the
                                        token
                                    </li>
                                </ul>
                            </div>
                            <div>
                                <p className="mb-2 text-[13px] font-semibold tracking-[-0.13px] text-text">
                                    What we never store
                                </p>
                                <ul className="list-disc space-y-1 pl-4 text-[13px] text-muted">
                                    <li>Prompts, code, or file paths</li>
                                    <li>Email or password</li>
                                    <li>Your raw token</li>
                                </ul>
                            </div>
                            <p className="text-[12px] text-muted sm:col-span-2">
                                Private by default — no email, no password. The
                                token is your only credential.{' '}
                                <strong className="text-text">
                                    If you lose it there&apos;s no recovery
                                </strong>{' '}
                                and the username is stranded; rotate it while
                                you still hold it, or{' '}
                                <a href="mailto:jackmcpickle@gmail.com?subject=tokenmaxer.quest%20lost%20token">
                                    contact us
                                </a>{' '}
                                if you&apos;re stuck.{' '}
                                <a href="/privacy">Full privacy details →</a>
                            </p>
                        </div>
                        <form
                            id="reg"
                            method="dialog"
                            onSubmit={(e) => {
                                void handleClaim(e);
                            }}
                        >
                            <label
                                className={field}
                                htmlFor="username"
                            >
                                <span className={fieldLbl}>
                                    Username (2–32 chars: letters, numbers, _ or
                                    -)
                                </span>
                                <Input
                                    variant="text"
                                    id="username"
                                    name="username"
                                    placeholder="e.g. tokenlord"
                                    autoComplete="off"
                                    required
                                />
                            </label>
                            <label
                                className={field}
                                htmlFor="country"
                            >
                                <span className={fieldLbl}>Country</span>
                                <Input
                                    variant="select"
                                    id="country"
                                    name="country"
                                    required
                                    defaultValue=""
                                >
                                    <option
                                        value=""
                                        disabled
                                    >
                                        Select country…
                                    </option>
                                    {COUNTRIES.map((ctry) => (
                                        <option
                                            key={ctry.code}
                                            value={ctry.code}
                                        >
                                            {`${flagEmoji(ctry.code)} ${ctry.name}`}
                                        </option>
                                    ))}
                                </Input>
                            </label>
                            <label
                                className={field}
                                htmlFor="profile-url"
                            >
                                <span className={fieldLbl}>
                                    Profile URL (optional, https)
                                </span>
                                <Input
                                    variant="text"
                                    id="profile-url"
                                    name="profile-url"
                                    placeholder="https://github.com/you"
                                    autoComplete="off"
                                />
                            </label>
                            <div
                                ref={turnstileHost}
                                className="mb-4"
                            />
                            <Button
                                variant="primary"
                                type="submit"
                                disabled={claiming}
                            >
                                {claiming ? 'Claiming…' : 'Claim username'}
                            </Button>
                            <span
                                id="err"
                                className="ml-3 text-danger"
                            >
                                {error}
                            </span>
                        </form>
                    </div>

                    <aside className="spotlight spotlight-orange">
                        {SETUP_TIP}
                    </aside>
                </div>
            )}

            {claimed !== null && (
                <div
                    id="result"
                    ref={resultRef}
                    className="mt-6"
                >
                    <div className={notice}>
                        <strong>
                            Welcome, <span id="r-user">{claimed.username}</span>
                            .
                        </strong>{' '}
                        Your token is shown once — save it now. Lost tokens
                        can&apos;t be recovered.
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                        <div className={panel}>
                            <h2 className="mt-0">Your token</h2>
                            <div className={copyrow}>
                                <pre id="r-token">{claimed.token}</pre>
                                <CopyButton text={claimed.token} />
                            </div>
                            <p className={`${sub} mt-4 mb-0`}>
                                <a
                                    id="r-profile"
                                    href={`/u/${claimed.username}`}
                                >
                                    View your profile →
                                </a>
                            </p>
                        </div>

                        <aside className="spotlight spotlight-magenta h-fit">
                            <p className="mb-3 text-[13px] font-medium tracking-[-0.13px] text-white/80">
                                Keep the token
                            </p>
                            <p className="text-[22px] leading-snug tracking-[-0.01px]">
                                Store it offline. There&apos;s no email recovery
                                — the hash on the server can&apos;t recreate the
                                secret.
                            </p>
                        </aside>
                    </div>
                </div>
            )}

            <StartSetup
                snippets={snippets}
                splitLayout={invited === false}
                aside={
                    invited === false ? (
                        <aside className="spotlight spotlight-orange h-fit">
                            {SETUP_TIP}
                        </aside>
                    ) : undefined
                }
            />

            {showForm && (
                <script
                    src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                    async
                    defer
                />
            )}
        </Layout>
    );
};
