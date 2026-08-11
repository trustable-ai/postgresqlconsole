const Index = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-muted">
      <div className="w-full max-w-md px-6">
        <div className="flex flex-col items-center space-y-8">
          {/* Logo */}
          <div className="animate-in fade-in zoom-in duration-500">
            <img
              src="/trustable.png"
              alt="Trustable Logo"
              className="h-24 w-auto"
            />
          </div>

          {/* Splash */}
          <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
            <img
              src="/splash.png"
              alt="Splash"
              className="w-full h-auto rounded-2xl"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
