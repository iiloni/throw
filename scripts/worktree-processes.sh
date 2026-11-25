# shellcheck shell=bash
# Stops host processes that belong to one worktree, such as the live-reload
# `cap run android` that `./scripts/dev.sh android` leaves running until Ctrl+C.
# Sourced by dev.sh (down, destroy) and worktree.sh (remove), so stopping or removing a
# worktree does not leave them holding memory.
#
# A process belongs to the worktree when it is the `dev.sh android` session recorded in
# the worktree's pidfile, or a `cap run android` whose arguments (or, failing those, its
# working directory) lie in that worktree rather than in another one nested in it. Their
# descendants go with them. Nothing else is matched: editors, shells and agents that merely
# work in the checkout are left alone, and so are this script and every process it runs
# under, even when those match.

# Kept in the worktree's own Git directory: never a file in the checkout, and removed
# with the worktree.
android_pidfile() {
    local git_dir
    git_dir=$(git -C "$1" rev-parse --path-format=absolute --git-dir 2>/dev/null) || return 1
    printf '%s/throw-android.pid' "$git_dir"
}

# Sets stat_state, stat_ppid and stat_start (start time in clock ticks, which tells a
# process from a later one given the same PID).
read_proc_stat() {
    local line IFS=' '
    local -a fields
    { read -r line <"/proc/$1/stat"; } 2>/dev/null || return 1
    # The command name is in parentheses and may contain spaces or parentheses itself.
    # What follows is numbers and a state letter, so splitting cannot glob.
    # shellcheck disable=SC2206
    fields=(${line##*) })
    stat_state=${fields[0]} stat_ppid=${fields[1]} stat_start=${fields[19]}
}

# The `dev.sh android` session records itself so `down` can stop it.
record_android_session() {
    local pidfile
    pidfile=$(android_pidfile "$1") || return 0
    read_proc_stat "$$" || return 0
    printf '%s %s\n' "$$" "$stat_start" >"$pidfile"
    # shellcheck disable=SC2064 # Expand the path now; the trap runs after it is gone.
    trap "release_android_session '$pidfile'" EXIT
}

release_android_session() {
    local recorded_pid=''
    { read -r recorded_pid _ <"$1"; } 2>/dev/null || return 0
    [[ "$recorded_pid" != "$$" ]] || rm -f "$1"
}

# The worktree a path lies in: the longest of the given roots that contains it.
owning_worktree() {
    local path=$1 root best=''
    shift
    for root in "$@"; do
        [[ "$path" == "$root" || "$path" == "$root"/* ]] || continue
        ((${#root} > ${#best})) && best=$root
    done
    printf '%s' "$best"
}

stop_worktree_processes() {
    # Without /proc (macOS) there is nothing reliable to match on.
    [[ -r /proc/self/stat ]] || return 0
    local root worktree
    root=$(cd "$1" 2>/dev/null && pwd -P) || root=$1
    local -a roots=("$root")
    while IFS= read -r worktree; do
        [[ -d "$worktree" ]] && worktree=$(cd "$worktree" && pwd -P)
        roots+=("$worktree")
    done < <(git -C "$root" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')

    # This shell and everything it runs under: the caller's terminal, shell or agent.
    local -A keep=() parent=() start=() target=()
    local pid=$BASHPID
    while [[ "$pid" =~ ^[1-9][0-9]*$ && -z "${keep[$pid]:-}" ]]; do
        keep[$pid]=1
        read_proc_stat "$pid" || break
        pid=$stat_ppid
    done
    keep[$$]=1

    local signature='[ /](cap|capacitor) run android '
    local dir arg owner cwd
    local -a argv candidates=()
    for dir in /proc/[0-9]*; do
        pid=${dir#/proc/}
        [[ -O "$dir" ]] || continue
        read_proc_stat "$pid" || continue
        [[ "$stat_state" != Z ]] || continue
        parent[$pid]=$stat_ppid
        start[$pid]=$stat_start
        { mapfile -d '' -t argv <"$dir/cmdline"; } 2>/dev/null || continue
        [[ " ${argv[*]} " =~ $signature ]] || continue
        # `pnpm --dir <worktree>/apps/web` and Capacitor's own script name the worktree
        # they run from; the working directory may be anywhere for the former.
        owner=''
        for arg in "${argv[@]}"; do
            arg=${arg#--*=}
            [[ "$arg" == /* ]] || continue
            owner=$(owning_worktree "$arg" "${roots[@]}")
            [[ -z "$owner" ]] || break
        done
        if [[ -z "$owner" ]]; then
            cwd=$(readlink "$dir/cwd" 2>/dev/null) || continue
            owner=$(owning_worktree "${cwd% (deleted)}" "${roots[@]}")
        fi
        [[ "$owner" != "$root" ]] || candidates+=("$pid")
    done

    local pidfile recorded_pid='' recorded_start=''
    if pidfile=$(android_pidfile "$root") && [[ -f "$pidfile" ]]; then
        { read -r recorded_pid recorded_start _ <"$pidfile"; } 2>/dev/null || true
        if [[ "$recorded_pid" =~ ^[0-9]+$ && "${start[$recorded_pid]:-}" == "$recorded_start" ]]; then
            candidates+=("$recorded_pid")
        fi
        rm -f "$pidfile"
    fi

    local child
    local -a queue=()
    ((${#candidates[@]})) && queue=("${candidates[@]}")
    while ((${#queue[@]})); do
        pid=${queue[0]}
        queue=("${queue[@]:1}")
        [[ -z "${keep[$pid]:-}" && -z "${target[$pid]:-}" ]] || continue
        target[$pid]=1
        for child in "${!parent[@]}"; do
            [[ "${parent[$child]}" != "$pid" ]] || queue+=("$child")
        done
    done
    ((${#target[@]})) || return 0

    echo "Stopping host processes from $root:"
    for pid in "${!target[@]}"; do
        { mapfile -d '' -t argv <"/proc/$pid/cmdline"; } 2>/dev/null || argv=()
        printf '  %s %.150s\n' "$pid" "${argv[*]}"
    done

    # Interrupt first, as Ctrl+C would: live reload restores the Capacitor config it
    # rewrote only on SIGINT. Then terminate, then kill whatever is left.
    local signal poll polls=${THROW_STOP_PROCESS_POLLS:-30}
    for signal in INT TERM KILL; do
        for pid in "${!target[@]}"; do
            kill -s "$signal" "$pid" 2>/dev/null || true
        done
        for ((poll = 0; poll < polls; poll++)); do
            for pid in "${!target[@]}"; do
                if ! read_proc_stat "$pid" || [[ "$stat_state" == Z || "$stat_start" != "${start[$pid]}" ]]; then
                    unset "target[$pid]"
                fi
            done
            ((${#target[@]})) || return 0
            sleep 0.1
        done
    done
    echo "Could not stop: ${!target[*]}" >&2
}
