// "Invite to Portal" from a customer: pick the customer's email and/or its people (contacts), send invites.
// Also sends the customer's Customer Price Group, so the portal shows the right price list.
codeunit 99722 "JSHP Portal Invite"
{
    var
        NothingSelectedMsg: Label 'No one was selected, so no invites were sent.';
        ResultMsg: Label 'Invites sent: %1. Failed: %2.\%3', Comment = '%1 = sent, %2 = failed, %3 = details';
        NoEmailErr: Label 'This customer has no email address and no contacts with one. Add an email first.';

    procedure InviteFromCustomer(Customer: Record Customer)
    var
        TempBuffer: Record "JSHP Invite Buffer" temporary;
        InvitePage: Page "JSHP Invite to Portal";
    begin
        FillBuffer(Customer, TempBuffer);
        if TempBuffer.IsEmpty() then
            Error(NoEmailErr);
        InvitePage.SetData(TempBuffer, Customer);
        InvitePage.LookupMode(true);
        if InvitePage.RunModal() <> Action::LookupOK then
            exit;
        InvitePage.GetData(TempBuffer);
        SendInvites(Customer, TempBuffer);
    end;

    local procedure FillBuffer(Customer: Record Customer; var TempBuffer: Record "JSHP Invite Buffer" temporary)
    var
        ContBusRel: Record "Contact Business Relation";
        Contact: Record Contact;
        LineNo: Integer;
    begin
        TempBuffer.DeleteAll();
        if Customer."E-Mail" <> '' then
            AddLine(TempBuffer, LineNo, Customer."E-Mail", Customer.Contact, 'Customer card', true);

        // People linked to this customer's company contact.
        ContBusRel.SetRange("Link to Table", ContBusRel."Link to Table"::Customer);
        ContBusRel.SetRange("No.", Customer."No.");
        if ContBusRel.FindFirst() then begin
            Contact.SetRange("Company No.", ContBusRel."Contact No.");
            Contact.SetRange(Type, Contact.Type::Person);
            Contact.SetFilter("E-Mail", '<>%1', '');
            if Contact.FindSet() then
                repeat
                    if not EmailInBuffer(TempBuffer, Contact."E-Mail") then
                        AddLine(TempBuffer, LineNo, Contact."E-Mail", Contact.Name, 'Contact ' + Contact."No.", false);
                until Contact.Next() = 0;
        end;
    end;

    local procedure AddLine(var TempBuffer: Record "JSHP Invite Buffer" temporary; var LineNo: Integer; Email: Text; Name: Text; Source: Text; Select: Boolean)
    begin
        LineNo += 10000;
        TempBuffer.Init();
        TempBuffer."Line No." := LineNo;
        TempBuffer."E-Mail" := CopyStr(Email, 1, MaxStrLen(TempBuffer."E-Mail"));
        TempBuffer.Name := CopyStr(Name, 1, MaxStrLen(TempBuffer.Name));
        TempBuffer.Source := CopyStr(Source, 1, MaxStrLen(TempBuffer.Source));
        TempBuffer.Selected := Select;
        TempBuffer.Insert();
    end;

    local procedure EmailInBuffer(var TempBuffer: Record "JSHP Invite Buffer" temporary; Email: Text): Boolean
    var
        Found: Boolean;
    begin
        if TempBuffer.FindSet() then
            repeat
                if LowerCase(TempBuffer."E-Mail") = LowerCase(Email) then
                    Found := true;
            until Found or (TempBuffer.Next() = 0);
        exit(Found);
    end;

    local procedure SendInvites(Customer: Record Customer; var TempBuffer: Record "JSHP Invite Buffer" temporary)
    var
        PortalClient: Codeunit "JSHP Portal Client";
        Body: JsonObject;
        ResponseText: Text;
        Details: TextBuilder;
        Sent: Integer;
        Failed: Integer;
    begin
        TempBuffer.SetRange(Selected, true);
        if not TempBuffer.FindSet() then begin
            Message(NothingSelectedMsg);
            exit;
        end;
        repeat
            Clear(Body);
            Body.Add('email', TempBuffer."E-Mail");
            Body.Add('name', TempBuffer.Name);
            Body.Add('customerNo', Customer."No.");
            Body.Add('priceGroup', Customer."Customer Price Group");
            if PortalClient.Post('/api/invites', Body, ResponseText) then begin
                Sent += 1;
                Details.AppendLine(TempBuffer."E-Mail" + ': sent');
            end else begin
                Failed += 1;
                Details.AppendLine(TempBuffer."E-Mail" + ': ' + PortalClient.ReadMessage(ResponseText));
            end;
        until TempBuffer.Next() = 0;
        Message(ResultMsg, Sent, Failed, Details.ToText());
    end;
}
