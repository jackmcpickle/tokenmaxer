import type { FC, ReactNode } from 'react';

export type InputVariant = 'text' | 'select';

const BASE =
    'ui-input w-full min-w-[130px] rounded-md border border-border bg-panel px-3.5 py-2.5 text-[15px] text-text outline-none';

type TextInputProps = {
    variant: 'text';
    id?: string;
    name?: string;
    className?: string;
    placeholder?: string;
    autoComplete?: string;
    required?: boolean;
    value?: string;
    /** HTML input type (default `text`). */
    type?: 'text' | 'datetime-local';
};

type SelectInputProps = {
    variant: 'select';
    id?: string;
    name?: string;
    className?: string;
    required?: boolean;
    /** Inline HTML `onchange` for progressive-enhancement form submit. */
    htmlOnChange?: string;
    children?: ReactNode;
};

export type InputProps = TextInputProps | SelectInputProps;

function cx(...parts: Array<string | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

export const Input: FC<InputProps> = (props) => {
    const className = cx(BASE, props.className);

    if (props.variant === 'select') {
        return (
            <select
                className={className}
                id={props.id}
                name={props.name}
                required={props.required}
                {...(props.htmlOnChange
                    ? ({ onchange: props.htmlOnChange } as object)
                    : {})}
            >
                {props.children}
            </select>
        );
    }

    if (props.type === 'datetime-local') {
        return (
            <input
                className={className}
                id={props.id}
                name={props.name}
                type="datetime-local"
                required={props.required}
                value={props.value}
            />
        );
    }

    return (
        <input
            className={className}
            id={props.id}
            name={props.name}
            type="text"
            placeholder={props.placeholder}
            autoComplete={props.autoComplete}
            required={props.required}
            value={props.value}
        />
    );
};
