import { useState, type FC } from 'react';
import { Button } from '@/pages/components/button';

function writeClipboard(text: string): Promise<void> {
    const g = globalThis as typeof globalThis & {
        navigator: { clipboard: { writeText: (s: string) => Promise<void> } };
    };
    return g.navigator.clipboard.writeText(text);
}

export const CopyButton: FC<{ text: string }> = ({ text }) => {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            variant="copy"
            type="button"
            onClick={() => {
                void writeClipboard(text).then(() => {
                    setCopied(true);
                    setTimeout(() => {
                        setCopied(false);
                    }, 1200);
                });
            }}
        >
            {copied ? 'Copied!' : 'Copy'}
        </Button>
    );
};
