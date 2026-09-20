import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", {
	variants: {
		variant: {
			default: "border-transparent bg-primary text-primary-foreground",
			secondary: "border-transparent bg-secondary text-secondary-foreground",
			destructive: "border-transparent bg-destructive text-white",
			outline: "border-border bg-transparent text-foreground",
		},
	},
	defaultVariants: {
		variant: "default",
	},
});

function Badge({ className, variant = "default", ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return <span data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
