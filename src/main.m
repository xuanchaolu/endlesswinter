/* ============================================================
 * 无尽冬日 · macOS 原生壳（Objective-C / ARC）
 * 原生窗口 + WKWebView 渲染 3D 游戏 + 存档桥接（应用支持目录）
 * ============================================================ */
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString *SavePath(void) {
    static NSString *path = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSString *dir = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory,
                                                             NSUserDomainMask, YES) firstObject];
        dir = [dir stringByAppendingPathComponent:@"EndlessWinter"];
        [[NSFileManager defaultManager] createDirectoryAtPath:dir
                                  withIntermediateDirectories:YES attributes:nil error:nil];
        path = [dir stringByAppendingPathComponent:@"save.json"];
    });
    return path;
}

/* 上一版存档（滚动备份）：写新档前把旧档挪过来 */
static NSString *PrevPath(void) {
    return [SavePath() stringByAppendingPathExtension:@"prev"];
}

/* 校验 JSON 至少像一份游戏存档（含 day 数字），防半截文件 */
static BOOL LooksValidSave(NSString *text) {
    if (text.length < 20) return NO;
    NSData *d = [text dataUsingEncoding:NSUTF8StringEncoding];
    if (!d) return NO;
    id obj = [NSJSONSerialization JSONObjectWithData:d options:0 error:nil];
    if (![obj isKindOfClass:[NSDictionary class]]) return NO;
    id day = obj[@"day"];
    return [day isKindOfClass:[NSNumber class]];
}

/* ---------------- 存档桥接 ---------------- */
@interface Bridge : NSObject <WKScriptMessageHandler>
@property (weak) WKWebView *webView;
@end

@implementation Bridge
- (void)userContentController:(WKUserContentController *)ucc
      didReceiveScriptMessage:(WKScriptMessage *)msg {
    if (![msg.name isEqualToString:@"bridge"]) return;
    if (![msg.body isKindOfClass:[NSString class]]) return;
    NSData *data = [(NSString *)msg.body dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *obj = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![obj isKindOfClass:[NSDictionary class]]) return;
    NSString *type = obj[@"type"];

    if ([type isEqualToString:@"save"]) {
        NSString *payload = obj[@"payload"];
        if ([payload isKindOfClass:[NSString class]] && LooksValidSave(payload)) {
            NSFileManager *fm = [NSFileManager defaultManager];
            NSString *main = SavePath();
            /* 滚动备份：旧主档 → save.prev.json */
            if ([fm fileExistsAtPath:main]) {
                [fm removeItemAtPath:PrevPath() error:nil];
                [fm copyItemAtPath:main toPath:PrevPath() error:nil];
            }
            [payload writeToFile:main atomically:YES encoding:NSUTF8StringEncoding error:nil];
        }
    } else if ([type isEqualToString:@"load"]) {
        NSString *text = [NSString stringWithContentsOfFile:SavePath()
                                                   encoding:NSUTF8StringEncoding error:nil];
        if (!LooksValidSave(text)) {
            /* 主档缺失/损坏 → 回退上一版滚动备份 */
            text = [NSString stringWithContentsOfFile:PrevPath()
                                             encoding:NSUTF8StringEncoding error:nil];
            if (LooksValidSave(text)) NSLog(@"[SAVE] 主档不可用，已从 save.prev.json 回退");
        }
        NSString *js = @"NativeBridge._receive(null)";
        if (text.length > 0) {
            NSData *probe = [text dataUsingEncoding:NSUTF8StringEncoding];
            NSDictionary *probeObj = probe ? [NSJSONSerialization JSONObjectWithData:probe options:0 error:nil] : nil;
            NSLog(@"[SAVE] 加载存档 day=%@ pop=%@ furnace=%@ tech=%lu",
                  probeObj[@"day"] ?: @"?",
                  probeObj[@"pop"] ?: @"?",
                  [probeObj[@"lvls"] valueForKey:@"furnace"] ?: @"?",
                  (unsigned long)[probeObj[@"tech"] count]);
        } else {
            NSLog(@"[SAVE] 无可用存档（主档与 prev 均缺失）");
        }
        if (text.length > 0) {
            NSData *lit = [NSJSONSerialization dataWithJSONObject:@[ text ] options:0 error:nil];
            if (lit) {
                NSString *litStr = [[NSString alloc] initWithData:lit encoding:NSUTF8StringEncoding];
                js = [NSString stringWithFormat:@"NativeBridge._receive(%@[0])", litStr];
            }
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            [self.webView evaluateJavaScript:js completionHandler:^(id _Nullable result, NSError * _Nullable error) {
                if (error) NSLog(@"[SAVE] evaluateJavaScript 失败: %@", error.localizedDescription);
            }];
        });
    } else if ([type isEqualToString:@"delete"]) {
        [[NSFileManager defaultManager] removeItemAtPath:SavePath() error:nil];
    } else if ([type isEqualToString:@"jsError"]) {
        NSLog(@"[JS ERROR] %@ @ %@:%@", obj[@"msg"] ?: @"?", obj[@"src"] ?: @"", obj[@"line"] ?: @"");
    } else if ([type isEqualToString:@"boot"]) {
        NSLog(@"[BOOT] 游戏脚本初始化完成 版本=%@ webgl=%@",
              obj[@"ver"] ?: @"?", [obj[@"ok"] boolValue] ? @"YES" : @"NO");
    } else if ([type isEqualToString:@"firstFrame"]) {
        NSLog(@"[BOOT] 3D 首帧渲染成功");
    } else if ([type isEqualToString:@"jsLoaded"]) {
        NSLog(@"[SAVE] JS 已成功接收并解析存档");
    } else if ([type isEqualToString:@"autotest"]) {
        NSLog(@"[AUTOTEST] %@", obj[@"detail"] ?: (obj[@"ok"] ? @"成功" : @"失败"));
    }
}
@end

/* ---------------- 应用委托 ---------------- */
@interface AppDelegate : NSObject <NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate>
@property (strong) NSWindow *window;
@property (strong) WKWebView *webView;
@property (strong) Bridge *bridge;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)note {
    self.bridge = [Bridge new];

    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    /* 非持久化存储：彻底避免 file:// 资源被缓存（游戏存档走原生桥，不依赖 WebView 存储） */
    config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
    [config.userContentController addScriptMessageHandler:self.bridge name:@"bridge"];
    [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];

    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:config];
    self.webView.UIDelegate = self;
    self.webView.navigationDelegate = self;
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.bridge.webView = self.webView;

    NSRect content = NSMakeRect(0, 0, 1360, 850);
    self.window = [[NSWindow alloc] initWithContentRect:content
                                              styleMask:NSTitledWindowMask | NSClosableWindowMask |
                                                        NSMiniaturizableWindowMask | NSResizableWindowMask
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    self.window.title = @"无尽冬日";
    self.window.minSize = NSMakeSize(1180, 720);
    self.window.backgroundColor = [NSColor colorWithCalibratedRed:0.024 green:0.051 blue:0.102 alpha:1];
    [self.window.contentView addSubview:self.webView];
    self.webView.frame = self.window.contentView.bounds;
    [self.window center];
    [self makeMenus];

    NSURL *resURL = NSBundle.mainBundle.resourceURL;
    NSURL *indexURL = [resURL URLByAppendingPathComponent:@"game/index.html"];
    if (indexURL) [self.webView loadFileURL:indexURL allowingReadAccessToURL:resURL];

    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

/* 自动测试钩子：--autotest 启动时通知页面自动执行一键满级 */
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    BOOL autotest = [[NSProcessInfo processInfo].arguments containsObject:@"--autotest"];
    NSLog(@"[AUTOTEST] didFinishNavigation 触发 autotest=%d", autotest);
    if (autotest) {
        [webView evaluateJavaScript:@"window.__AUTOTEST__ = true;"
                  completionHandler:^(id _Nullable r, NSError * _Nullable e) {
                      NSLog(@"[AUTOTEST] 注入完成 error=%@", e ? e.localizedDescription : @"无");
                  }];
    }
}

- (void)makeMenus {
    NSMenu *main = [NSMenu new];

    NSMenuItem *appItem = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    [main addItem:appItem];
    NSMenu *appMenu = [NSMenu new];
    [appMenu addItem:[[NSMenuItem alloc] initWithTitle:@"关于无尽冬日"
                                                action:@selector(orderFrontStandardAboutPanel:)
                                         keyEquivalent:@""]];
    [appMenu addItem:[NSMenuItem separatorItem]];
    NSMenuItem *hide = [[NSMenuItem alloc] initWithTitle:@"隐藏无尽冬日"
                                                  action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItem:hide];
    [appMenu addItem:[[NSMenuItem alloc] initWithTitle:@"退出无尽冬日"
                                                action:@selector(terminate:) keyEquivalent:@"q"]];
    appItem.submenu = appMenu;

    NSMenuItem *winItem = [[NSMenuItem alloc] initWithTitle:@"窗口" action:nil keyEquivalent:@""];
    [main addItem:winItem];
    NSMenu *winMenu = [[NSMenu alloc] initWithTitle:@"窗口"];
    [winMenu addItem:[[NSMenuItem alloc] initWithTitle:@"最小化"
                                                action:@selector(performMiniaturize:) keyEquivalent:@"m"]];
    winItem.submenu = winMenu;

    NSApp.mainMenu = main;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app { return YES; }

- (BOOL)applicationSupportsSecureRestorableState:(NSApplication *)app { return YES; }

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        AppDelegate *delegate = [AppDelegate new];
        app.delegate = delegate;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        [app run];
    }
    return 0;
}
