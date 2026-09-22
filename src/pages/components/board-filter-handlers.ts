import type { RefObject } from 'react';
import type { DialogHandle } from '@/pages/components/filter-dialog';

export function closeFilterMenu(
    menuRef: RefObject<{ open: boolean } | null>,
): void {
    if (menuRef.current) menuRef.current.open = false;
}

export function openFilterDialog(
    dialogRef: RefObject<DialogHandle | null>,
): void {
    dialogRef.current?.showModal();
}

export function openFilterDialogFromMenu(
    menuRef: RefObject<{ open: boolean } | null>,
    dialogRef: RefObject<DialogHandle | null>,
): void {
    closeFilterMenu(menuRef);
    openFilterDialog(dialogRef);
}
