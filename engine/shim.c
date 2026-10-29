/* lumen-mpv.dll: the one libmpv call Lumen can't make directly from Go.
 * mpv_wait_event() takes its timeout as a double; Go's Windows syscall layer
 * passes floating-point arguments correctly on x64 but not on ARM64, so this
 * wrapper takes milliseconds as an integer instead. Built by engine.yml. */
#include <mpv/client.h>
#include <stdint.h>

__declspec(dllexport) mpv_event *lumen_wait_event(mpv_handle *h, int32_t timeout_ms)
{
    return mpv_wait_event(h, timeout_ms < 0 ? -1.0 : timeout_ms / 1000.0);
}

__declspec(dllexport) int32_t lumen_shim_version(void) { return 1; }
