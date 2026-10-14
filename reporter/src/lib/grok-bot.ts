// Grok Bot is a Cursor (Anysphere) product: its turns are billed through the
// Cursor account and arrive in the same dashboard usage feed as editor usage,
// told apart only by the model name. Current rows are `grok-bot-default`,
// `grok-bot-automation` and `grok-bot-cua`; early builds used the internal
// codename `sand-*`. Grok models used inside the editor (`grok-4.7-high`,
// `cursor-grok-4.6-high-fast`) are ordinary Cursor usage and must not match.
//
// Mirrored in src/lib/grok-bot.ts on the server, which re-tags rows that
// reporters older than the split still upload as Cursor.
const GROK_BOT_MODEL = /^(?:grok-bot|sand)(?:-|$)/iu;

export function isGrokBotModel(model: string): boolean {
    return GROK_BOT_MODEL.test(model.trim());
}
