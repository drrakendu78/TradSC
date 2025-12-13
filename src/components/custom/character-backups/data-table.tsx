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
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    return (
<<<<<<< HEAD
        <div className="rounded-md border border-border/50 bg-background/40 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
            <Table className="!bg-transparent">
                <TableHeader className="bg-background/60 backdrop-blur-md border-b border-border/50">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id} className="hover:bg-transparent border-0">
                            {headerGroup.headers.map((header) => (
                                <TableHead key={header.id} className="font-semibold text-foreground/90">
=======
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <TableHead key={header.id}>
>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(header.column.columnDef.header, header.getContext())}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
<<<<<<< HEAD
                <TableBody className="bg-transparent">
                    {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row, index) => (
                            <TableRow
                                key={row.id}
                                data-state={row.getIsSelected() && "selected"}
                                className="transition-all duration-200 hover:bg-muted/50 border-b border-border/30 last:border-0 bg-transparent"
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id} className="py-4">
=======
                <TableBody>
                    {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id}>
>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
<<<<<<< HEAD
                        <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={columns.length} className="h-32 text-center">
                                <div className="flex flex-col items-center gap-2">
                                    <div className="text-muted-foreground text-lg">Aucune sauvegarde pour le moment</div>
                                    <div className="text-muted-foreground/60 text-sm">Créez une sauvegarde pour commencer</div>
                                </div>
=======
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center">
                                Aucune sauvegarde pour le moment
>>>>>>> 8ea516e4f0f165d82c640cc411c57b6d77c9c98b
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    );
}

