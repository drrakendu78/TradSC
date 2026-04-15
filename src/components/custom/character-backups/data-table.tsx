import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from "@tanstack/react-table";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
}

export function DataTable<TData, TValue>({ columns, data }: DataTableProps<TData, TValue>) {
    const hasData = data.length > 0;

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    return (
        <div className="relative overflow-hidden rounded-2xl border border-border/45 bg-[hsl(var(--background)/0.16)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-primary/8 to-transparent" />
            <div className={`relative max-h-[58vh] overflow-y-auto ${hasData ? "" : "min-h-[220px]"}`}>
                <Table className="!bg-transparent">
                    <TableHeader className="sticky top-0 z-10 border-b border-border/45 bg-[hsl(var(--background)/0.60)] backdrop-blur-xl">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id} className="border-0 hover:bg-transparent">
                                {headerGroup.headers.map((header) => (
                                    <TableHead key={header.id} className="h-9 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/75">
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(header.column.columnDef.header, header.getContext())}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody className="bg-transparent">
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    className="border-b border-border/25 bg-transparent transition-colors odd:bg-[hsl(var(--background)/0.02)] hover:bg-[hsl(var(--primary)/0.08)] last:border-0"
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className="py-2.5 text-sm">
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={columns.length} className="h-28 text-center">
                                    <div className="flex flex-col items-center gap-1">
                                        <div className="text-base text-muted-foreground">Aucune sauvegarde pour le moment</div>
                                        <div className="text-xs text-muted-foreground/70">Creez une sauvegarde pour commencer</div>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
