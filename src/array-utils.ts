//! https://stackoverflow.com/a/32234086

// the only difference between minBy and maxBy is the ordering
// function, so abstract that out
export function minBy<T>(arr: T[], fn: (el: T) => number) {
    return extremumBy(arr, fn, Math.min);
}

export function maxBy<T>(arr: T[], fn: (el: T) => number) {
    return extremumBy(arr, fn, Math.max);
}

export function extremumBy<T>(
    arr: T[],
    pluck: (el: T) => number,
    extremum: (...values: number[]) => number
): T | undefined {
    return arr.reduce((best, next) => {
        const pair: [number, T] = [pluck(next), next];
        if (best === undefined) {
            return pair;
        } else if (extremum.apply(null, [best[0], pair[0]]) == best[0]) {
            return best;
        } else {
            return pair;
        }
    }, undefined as [number, T] | undefined)?.[1];
}
