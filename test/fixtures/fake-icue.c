// Stand-in for iCUESDK with the same exported functions and struct layouts, for tests on Linux.
#include <string.h>
#include <pthread.h>
#include <unistd.h>
#include <stdio.h>
typedef struct { int major, minor, patch; } V;
typedef struct { V c, s, h; } D;
typedef struct { int state; D details; } SC;
typedef void (*H)(void *ctx, const SC *ev);
typedef struct { int type; char id[128]; char serial[128]; char model[128]; int ledCount; int channelCount; } DI;
typedef struct { unsigned int id; double cx; double cy; } LP;
typedef struct { unsigned int id; unsigned char r, g, b, a; } LC;
static H handler; static void *hctx; static int connected = 0;
static LC last[512]; static int lastN = 0; static char lastDev[128]; static int calls = 0; static unsigned prio = 0;
static void *run(void *x) { SC ev; memset(&ev, 0, sizeof ev); ev.state = 2; handler(hctx, &ev); usleep(50000); connected = 1; ev.state = 6; handler(hctx, &ev); return 0; }
int CorsairConnect(H h, void *ctx) { handler = h; hctx = ctx; pthread_t t; pthread_create(&t, 0, run, 0); pthread_detach(t); return 0; }
int CorsairDisconnect() { connected = 0; return 0; }
int CorsairGetDevices(const int *filter, int max, DI *out, int *size) {
  if (!connected) return 1;
  memset(out, 0, sizeof(DI) * 2);
  out[0].type = 0x0001; strcpy(out[0].id, "{KB-1}"); strcpy(out[0].model, "K70 RGB"); out[0].ledCount = 3;
  out[1].type = 0x0020; strcpy(out[1].id, "{FANS-1}"); strcpy(out[1].model, "Commander Core"); out[1].ledCount = 2;
  *size = 2; return 0;
}
int CorsairGetLedPositions(const char *id, int max, LP *out, int *size) {
  if (!connected) return 1;
  if (!strcmp(id, "{KB-1}")) { for (int i = 0; i < 3; i++) { out[i].id = 100 + i; out[i].cx = i * 10; out[i].cy = 5; } *size = 3; return 0; }
  if (!strcmp(id, "{FANS-1}")) { for (int i = 0; i < 2; i++) { out[i].id = 200 + i; out[i].cx = 1; out[i].cy = i * 20; } *size = 2; return 0; }
  return 6;
}
int CorsairSetLedColors(const char *id, int n, const LC *c) { if (!connected) return 1; strcpy(lastDev, id); memcpy(last, c, sizeof(LC) * n); lastN = n; calls++; return 0; }
int CorsairSetLayerPriority(unsigned p) { prio = p; return 0; }
// test hooks
int FakeLast(char *dev, LC *out) { strcpy(dev, lastDev); memcpy(out, last, sizeof(LC) * lastN); return lastN; }
int FakeCalls() { return calls; }
unsigned FakePriority() { return prio; }
