page 99720 "JSHP Portal Setup"
{
    Caption = 'JSH Trade Portal Setup';
    PageType = Card;
    SourceTable = "JSHP Portal Setup";
    UsageCategory = Administration;
    ApplicationArea = All;
    InsertAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            group(Connection)
            {
                Caption = 'Connection';
                field("Portal URL"; Rec."Portal URL")
                {
                    ApplicationArea = All;
                    ToolTip = 'The portal''s address, e.g. https://polite-ground-09d5bbe10.6.azurestaticapps.net';
                }
                field(KeyStatus; KeyStatusText)
                {
                    ApplicationArea = All;
                    Caption = 'Portal Key';
                    Editable = false;
                    ToolTip = 'Whether the shared key (BC_PORTAL_KEY in Azure) is stored. Use Set Portal Key to change it.';
                }
            }
            group(Confirmations)
            {
                Caption = 'Order Confirmations';
                field("Send Confirmations"; Rec."Send Confirmations")
                {
                    ApplicationArea = All;
                    ToolTip = 'When on, the job queue tells the portal about portal orders that are Released with Order Reviewed = Reviewed. The portal then emails the confirmation.';
                }
                field("Confirm From Date"; Rec."Confirm From Date")
                {
                    ApplicationArea = All;
                    ToolTip = 'Only orders dated on or after this date are confirmed by email, so older orders never trigger emails.';
                }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(SetKey)
            {
                ApplicationArea = All;
                Caption = 'Set Portal Key';
                Image = EncryptionKeys;
                ToolTip = 'Store the shared key. It must match BC_PORTAL_KEY in Azure.';
                trigger OnAction()
                var
                    KeyDialog: Page "JSHP Portal Key Dialog";
                    PortalClient: Codeunit "JSHP Portal Client";
                begin
                    if KeyDialog.RunModal() = Action::OK then begin
                        PortalClient.SetKey(KeyDialog.GetKey());
                        UpdateKeyStatus();
                    end;
                end;
            }
            action(RunNow)
            {
                ApplicationArea = All;
                Caption = 'Send Confirmations Now';
                Image = SendMail;
                ToolTip = 'Run the confirmation check once now, without waiting for the job queue.';
                trigger OnAction()
                begin
                    Codeunit.Run(Codeunit::"JSHP Confirm Notifier");
                    Message(DoneMsg);
                end;
            }
            action(Log)
            {
                ApplicationArea = All;
                Caption = 'Notification Log';
                Image = Log;
                RunObject = page "JSHP Portal Notification Log";
                ToolTip = 'Orders the portal has been told about.';
            }
        }
    }

    var
        KeyStatusText: Text;
        DoneMsg: Label 'Done. See the Notification Log for what was sent.';

    trigger OnOpenPage()
    begin
        Rec.GetOrCreate();
        UpdateKeyStatus();
    end;

    local procedure UpdateKeyStatus()
    var
        PortalClient: Codeunit "JSHP Portal Client";
    begin
        if PortalClient.HasKey() then
            KeyStatusText := 'Stored'
        else
            KeyStatusText := 'Not set';
    end;
}

page 99721 "JSHP Portal Key Dialog"
{
    Caption = 'Set Portal Key';
    PageType = StandardDialog;

    layout
    {
        area(Content)
        {
            field(PortalKey; PortalKey)
            {
                ApplicationArea = All;
                Caption = 'Portal Key';
                ExtendedDatatype = Masked;
                ToolTip = 'Paste the same value as BC_PORTAL_KEY in Azure (40+ characters). Leave empty to remove the key.';
            }
        }
    }

    var
        [NonDebuggable]
        PortalKey: Text;

    [NonDebuggable]
    procedure GetKey(): Text
    begin
        exit(PortalKey);
    end;
}

page 99722 "JSHP Portal Notification Log"
{
    Caption = 'JSH Trade Portal Notification Log';
    PageType = List;
    SourceTable = "JSHP Portal Notification Log";
    UsageCategory = History;
    ApplicationArea = All;
    Editable = false;
    SourceTableView = sorting("Order No.") order(descending);

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field("Order No."; Rec."Order No.") { ApplicationArea = All; ToolTip = 'Sales order.'; }
                field("Portal Order No."; Rec."Portal Order No.") { ApplicationArea = All; ToolTip = 'Portal order number.'; }
                field("Notified At"; Rec."Notified At") { ApplicationArea = All; ToolTip = 'When the portal was told.'; }
                field(Result; Rec.Result) { ApplicationArea = All; ToolTip = 'What the portal answered.'; }
            }
        }
    }
}

page 99723 "JSHP Invite to Portal"
{
    Caption = 'Invite to JSH Trade Portal';
    PageType = List;
    SourceTable = "JSHP Invite Buffer";
    SourceTableTemporary = true;
    InsertAllowed = true;
    DeleteAllowed = true;
    AutoSplitKey = true;

    layout
    {
        area(Content)
        {
            group(Info)
            {
                ShowCaption = false;
                InstructionalText = 'Tick the people to invite. You can add another email on a new line. Each person gets an email link to set their name, mobile and password. Inviting someone again sends a fresh link.';
                field(CustomerName; CustomerText)
                {
                    ApplicationArea = All;
                    Caption = 'Customer';
                    Editable = false;
                }
            }
            repeater(Lines)
            {
                field(Selected; Rec.Selected) { ApplicationArea = All; ToolTip = 'Invite this person.'; }
                field("E-Mail"; Rec."E-Mail") { ApplicationArea = All; ToolTip = 'Email address the invite goes to.'; }
                field(Name; Rec.Name) { ApplicationArea = All; ToolTip = 'Name (they can change it when they set up their account).'; }
                field(Source; Rec.Source) { ApplicationArea = All; ToolTip = 'Where this email came from.'; }
            }
        }
    }

    var
        CustomerText: Text;

    procedure SetData(var TempBuffer: Record "JSHP Invite Buffer" temporary; Customer: Record Customer)
    begin
        Rec.Copy(TempBuffer, true);
        CustomerText := Customer."No." + ' · ' + Customer.Name;
        if Customer."Customer Price Group" <> '' then
            CustomerText += ' · price group ' + Customer."Customer Price Group";
    end;

    procedure GetData(var TempBuffer: Record "JSHP Invite Buffer" temporary)
    begin
        TempBuffer.Copy(Rec, true);
    end;

    trigger OnNewRecord(BelowxRec: Boolean)
    begin
        Rec.Selected := true;
        Rec.Source := 'Added';
    end;
}
