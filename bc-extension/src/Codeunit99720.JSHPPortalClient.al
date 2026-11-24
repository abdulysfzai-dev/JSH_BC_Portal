// Calls the JSH Trade Portal. The shared key lives in isolated storage for this extension only.
codeunit 99720 "JSHP Portal Client"
{
    var
        KeyName: Label 'JSHPPortalKey', Locked = true;
        NoKeyErr: Label 'The portal key isn''t set. Open JSH Trade Portal Setup and use Set Portal Key.';
        NoUrlErr: Label 'The portal URL isn''t set. Open JSH Trade Portal Setup.';

    [NonDebuggable]
    procedure SetKey(NewKey: Text)
    begin
        if NewKey = '' then begin
            if IsolatedStorage.Contains(KeyName, DataScope::Module) then
                IsolatedStorage.Delete(KeyName, DataScope::Module);
            exit;
        end;
        IsolatedStorage.Set(KeyName, NewKey, DataScope::Module);
    end;

    procedure HasKey(): Boolean
    begin
        exit(IsolatedStorage.Contains(KeyName, DataScope::Module));
    end;

    // Returns true when the portal answered 2xx. ResponseText holds the portal's reply (or the error).
    [NonDebuggable]
    procedure Post(Path: Text; Body: JsonObject; var ResponseText: Text): Boolean
    var
        Setup: Record "JSHP Portal Setup";
        Client: HttpClient;
        Content: HttpContent;
        ContentHeaders: HttpHeaders;
        Response: HttpResponseMessage;
        BodyText: Text;
        PortalKey: Text;
    begin
        Setup.GetOrCreate();
        if Setup."Portal URL" = '' then
            Error(NoUrlErr);
        if not IsolatedStorage.Get(KeyName, DataScope::Module, PortalKey) then
            Error(NoKeyErr);
        Body.WriteTo(BodyText);
        Content.WriteFrom(BodyText);
        Content.GetHeaders(ContentHeaders);
        if ContentHeaders.Contains('Content-Type') then
            ContentHeaders.Remove('Content-Type');
        ContentHeaders.Add('Content-Type', 'application/json');
        Client.DefaultRequestHeaders.Add('x-bc-key', PortalKey);
        Client.Timeout(30000);
        if not Client.Post(Setup."Portal URL" + Path, Content, Response) then begin
            ResponseText := GetLastErrorText();
            exit(false);
        end;
        Response.Content.ReadAs(ResponseText);
        exit(Response.IsSuccessStatusCode());
    end;

    // Pulls a readable message out of the portal's JSON reply.
    procedure ReadMessage(ResponseText: Text): Text
    var
        Json: JsonObject;
        Token: JsonToken;
    begin
        if Json.ReadFrom(ResponseText) then begin
            if Json.Get('error', Token) then
                exit(Token.AsValue().AsText());
            if Json.Get('message', Token) then
                exit(Token.AsValue().AsText());
        end;
        exit(CopyStr(ResponseText, 1, 250));
    end;
}
