export interface BoardView<T> {
    displayEntries: T[];
    visibleCount: number;
    visibleKey: string;
}

export function initialBoardView<T>(
    entries: T[],
    key: string,
    pageSize: number,
): BoardView<T> {
    return {
        displayEntries: entries,
        visibleCount: pageSize,
        visibleKey: key,
    };
}

/** Keep the previous rows while a filter load is in flight, and reset the page only when the filter key changes. */
export function stepBoardView<T>(
    state: BoardView<T>,
    input: {
        entries: T[];
        pending: boolean;
        key: string;
        pageSize: number;
    },
): BoardView<T> {
    const displayEntries =
        input.pending || state.displayEntries === input.entries
            ? state.displayEntries
            : input.entries;
    const keyChanged = input.key !== state.visibleKey;
    if (!keyChanged && displayEntries === state.displayEntries) return state;
    if (!keyChanged) return { ...state, displayEntries };
    return {
        displayEntries,
        visibleCount: input.pageSize,
        visibleKey: input.key,
    };
}

export function showMoreBoard<T>(
    state: BoardView<T>,
    pageSize: number,
): BoardView<T> {
    return { ...state, visibleCount: state.visibleCount + pageSize };
}
