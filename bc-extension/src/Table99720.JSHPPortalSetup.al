// Where the portal is, and whether BC should talk to it. The shared key is kept in isolated storage, not in this table.
table 99720 "JSHP Portal Setup"
{
    Caption = 'JSH Trade Portal Setup';
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Primary Key"; Code[10]) { Caption = 'Primary Key'; }
        field(10; "Portal URL"; Text[250])
        {
            Caption = 'Portal URL';
            ExtendedDatatype = URL;
            trigger OnValidate()
            begin
                "Portal URL" := CopyStr("Portal URL".TrimEnd('/'), 1, MaxStrLen("Portal URL"));
                if ("Portal URL" <> '') and not "Portal URL".StartsWith('https://') then
                    Error(HttpsErr);
            end;
        }
        field(20; "Send Confirmations"; Boolean)
        {
            Caption = 'Send Order Confirmations';
        }
        field(30; "Confirm From Date"; Date)
        {
            Caption = 'Only Orders Dated From';
        }
    }

    keys
    {
        key(PK; "Primary Key") { Clustered = true; }
    }

    var
        HttpsErr: Label 'The portal URL must start with https://';

    procedure GetOrCreate()
    begin
        if not Get() then begin
            Init();
            "Confirm From Date" := Today;
            Insert();
        end;
    end;
}

// One line per order the portal has been told about, so each confirmation is sent once.
table 99721 "JSHP Portal Notification Log"
{
    Caption = 'JSH Trade Portal Notification Log';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Order No."; Code[20]) { Caption = 'Order No.'; }
        field(10; "Portal Order No."; Code[35]) { Caption = 'Portal Order No.'; }
        field(20; "Notified At"; DateTime) { Caption = 'Notified At'; }
        field(30; Result; Text[250]) { Caption = 'Result'; }
    }

    keys
    {
        key(PK; "Order No.") { Clustered = true; }
    }
}

// Temporary list of people to invite from a customer.
table 99722 "JSHP Invite Buffer"
{
    Caption = 'JSH Trade Portal Invite';
    TableType = Temporary;
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Line No."; Integer) { Caption = 'Line No.'; }
        field(10; Selected; Boolean) { Caption = 'Invite'; }
        field(20; "E-Mail"; Text[80]) { Caption = 'Email'; ExtendedDatatype = EMail; }
        field(30; Name; Text[100]) { Caption = 'Name'; }
        field(40; Source; Text[30]) { Caption = 'From'; Editable = false; }
        field(50; Result; Text[250]) { Caption = 'Result'; Editable = false; }
    }

    keys
    {
        key(PK; "Line No.") { Clustered = true; }
    }
}
