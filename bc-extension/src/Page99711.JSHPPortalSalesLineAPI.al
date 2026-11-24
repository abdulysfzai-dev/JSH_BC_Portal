// Lines of a portal sales order. Item lines only. Prices are never taken from the portal:
// BC sets them from the price list when the item and quantity are validated.
page 99711 "JSHP Portal Sales Line API"
{
    PageType = API;
    APIPublisher = 'JSHealth';
    APIGroup = 'portal';
    APIVersion = 'v1.0';
    EntityName = 'portalSalesOrderLine';
    EntitySetName = 'portalSalesOrderLines';
    EntityCaption = 'Portal Sales Order Line';
    EntitySetCaption = 'Portal Sales Order Lines';
    SourceTable = "Sales Line";
    SourceTableView = where("Document Type" = const(Order));
    ODataKeyFields = SystemId;
    DelayedInsert = true;
    InsertAllowed = true;
    ModifyAllowed = false;
    DeleteAllowed = false;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { Caption = 'Id'; Editable = false; }
                field(documentNumber; Rec."Document No.") { Caption = 'Document No.'; Editable = false; }
                field(lineNumber; Rec."Line No.") { Caption = 'Line No.'; Editable = false; }
                field(itemNumber; ItemNo) { Caption = 'Item No.'; }
                field(description; Rec.Description) { Caption = 'Description'; Editable = false; }
                field(unitOfMeasureCode; UoMCode) { Caption = 'Unit of Measure Code'; }
                field(quantity; Qty) { Caption = 'Quantity'; }
                field(unitPrice; Rec."Unit Price") { Caption = 'Unit Price'; Editable = false; }
                field(lineDiscountPercent; Rec."Line Discount %") { Caption = 'Line Discount %'; Editable = false; }
                field(lineAmount; Rec."Line Amount") { Caption = 'Line Amount'; Editable = false; }
                field(quantityShipped; Rec."Quantity Shipped") { Caption = 'Quantity Shipped'; Editable = false; }
                field(quantityInvoiced; Rec."Quantity Invoiced") { Caption = 'Quantity Invoiced'; Editable = false; }
            }
        }
    }

    var
        ItemNo: Code[20];
        UoMCode: Code[10];
        Qty: Decimal;
        ItemRequiredErr: Label 'itemNumber is required.';
        QtyErr: Label 'quantity must be more than 0.';

    trigger OnAfterGetRecord()
    begin
        ItemNo := Rec."No.";
        UoMCode := Rec."Unit of Measure Code";
        Qty := Rec.Quantity;
    end;

    trigger OnNewRecord(BelowxRec: Boolean)
    begin
        Clear(ItemNo); Clear(UoMCode); Clear(Qty);
    end;

    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    var
        SalesHeader: Record "Sales Header";
        LastLine: Record "Sales Line";
        DocNo: Code[20];
    begin
        if ItemNo = '' then
            Error(ItemRequiredErr);
        if Qty <= 0 then
            Error(QtyErr);
        // The parent order comes from the header page link (value on deep insert, filter on a direct call).
        DocNo := Rec."Document No.";
        if DocNo = '' then
            DocNo := CopyStr(Rec.GetFilter("Document No."), 1, MaxStrLen(DocNo));
        SalesHeader.Get(SalesHeader."Document Type"::Order, DocNo);

        LastLine.SetRange("Document Type", LastLine."Document Type"::Order);
        LastLine.SetRange("Document No.", DocNo);
        Rec.Init();
        Rec."Document Type" := Rec."Document Type"::Order;
        Rec."Document No." := DocNo;
        if LastLine.FindLast() then
            Rec."Line No." := LastLine."Line No." + 10000
        else
            Rec."Line No." := 10000;
        Rec.Insert(true);
        Rec.Validate(Type, Rec.Type::Item);
        Rec.Validate("No.", ItemNo);
        if UoMCode <> '' then
            Rec.Validate("Unit of Measure Code", UoMCode);
        Rec.Validate(Quantity, Qty);
        Rec.Modify(true);
        exit(false);
    end;
}
